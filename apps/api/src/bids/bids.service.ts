import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { PlaceBidDto } from './dto/place-bid.dto.js';
import { BidDto, PlaceBidResult } from '@bidstream/contracts';

interface LockedAuction {
  id: string;
  status: string;
  current_price: number;
  min_increment: number;
  end_time: Date;
  seller_id: string;
  winner_id: string | null;
  bid_count: number;
  version: number;
}

interface BidTxResult {
  bidResult: PlaceBidResult;
  isNewBid: boolean;
  previousHighestBidderId: string | null;
  previousPrice: number;
}

@Injectable()
export class BidsService {
  private readonly antiSnipingWindowMs = 60 * 1000; // 60 seconds
  private readonly antiSnipingExtensionMs = 60 * 1000; // 60 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: LifecycleService,
    private readonly realtimeGateway: RealtimeGateway,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async placeBid(
    auctionId: string,
    bidderId: string,
    dto: PlaceBidDto,
    idempotencyKey?: string,
  ): Promise<PlaceBidResult> {
    try {
      // 1. Check idempotency key before entering transaction
      if (idempotencyKey) {
        const existingKey = await this.prisma.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });
        if (existingKey && existingKey.expiresAt > new Date()) {
          return existingKey.responseBody as unknown as PlaceBidResult;
        }
      }

      let shouldReschedule = false;
      let extensionEndTime: Date | null = null;

      // 2. Execute single atomic transaction with row-level pessimistic locking
      const txResult: BidTxResult = await this.prisma.$transaction(
        async (tx) => {
          // Double-check idempotency key inside transaction
          if (idempotencyKey) {
            const existingInTx = await tx.idempotencyKey.findUnique({
              where: { key: idempotencyKey },
            });
            if (existingInTx && existingInTx.expiresAt > new Date()) {
              return {
                bidResult: existingInTx.responseBody as unknown as PlaceBidResult,
                isNewBid: false,
                previousHighestBidderId: null,
                previousPrice: 0,
              };
            }
          }

          // Lock auction row with SELECT ... FOR UPDATE
          const rows = await tx.$queryRaw<LockedAuction[]>`
            SELECT id, status, current_price, min_increment, end_time, seller_id, winner_id, bid_count, version
            FROM auctions
            WHERE id = ${auctionId}::uuid
            FOR UPDATE;
          `;

          const auction = rows[0];
          if (!auction) {
            throw new NotFoundException(`Auction with ID ${auctionId} not found`);
          }

          if (auction.status !== 'ACTIVE') {
            throw new ConflictException('Auction is not open for bidding');
          }

          const now = new Date();
          if (now >= auction.end_time) {
            throw new ConflictException('Auction has already ended');
          }

          if (auction.seller_id === bidderId) {
            throw new ForbiddenException('Sellers are not permitted to bid on their own listings');
          }

          if (auction.winner_id === bidderId) {
            throw new BadRequestException('You already hold the highest bid');
          }

          const minRequired = auction.current_price + auction.min_increment;
          if (dto.amount < minRequired) {
            throw new ConflictException(
              `Bid amount ${dto.amount} is below the minimum required amount of ${minRequired}`,
            );
          }

          const previousHighestBidderId = auction.winner_id;
          const previousPrice = Number(auction.current_price);

          // Anti-sniping dynamic extension
          const remainingTimeMs = auction.end_time.getTime() - now.getTime();
          const triggersAntiSniping = remainingTimeMs <= this.antiSnipingWindowMs;
          const newEndTime = triggersAntiSniping
            ? new Date(now.getTime() + this.antiSnipingExtensionMs)
            : auction.end_time;

          if (triggersAntiSniping) {
            shouldReschedule = true;
            extensionEndTime = newEndTime;
          }

          // Append-only insert into bids table
          const bid = await tx.bid.create({
            data: {
              auctionId,
              bidderId,
              amount: dto.amount,
            },
            include: {
              bidder: { select: { name: true } },
            },
          });

          // Update auction state
          const updatedAuction = await tx.auction.update({
            where: { id: auctionId },
            data: {
              currentPrice: dto.amount,
              bidCount: { increment: 1 },
              winnerId: bidderId,
              endTime: newEndTime,
              version: { increment: 1 },
            },
          });

          const bidResult: PlaceBidResult = {
            bid: {
              id: bid.id,
              auctionId: bid.auctionId,
              bidderId: bid.bidderId,
              bidderName: bid.bidder.name,
              amount: bid.amount,
              createdAt: bid.createdAt.toISOString(),
            },
            currentPrice: updatedAuction.currentPrice,
            bidCount: updatedAuction.bidCount,
            endTime: updatedAuction.endTime.toISOString(),
            extended: triggersAntiSniping,
          };

          // Persist idempotency key inside the transaction
          if (idempotencyKey) {
            await tx.idempotencyKey.create({
              data: {
                key: idempotencyKey,
                target: `POST /auctions/${auctionId}/bids`,
                responseStatus: 201,
                responseBody: bidResult as unknown as Prisma.InputJsonValue,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
              },
            });
          }

          return {
            bidResult,
            isNewBid: true,
            previousHighestBidderId,
            previousPrice,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );

      // 3. Post-transaction side-effect: reschedule BullMQ close job if anti-sniping was triggered
      if (shouldReschedule && extensionEndTime) {
        await this.lifecycleService.rescheduleAuctionClose(auctionId, extensionEndTime);
      }

      // 4. Real-time broadcast
      if (txResult.isNewBid) {
        this.realtimeGateway.broadcastBidPlaced({
          auctionId,
          bid: txResult.bidResult.bid,
          currentPrice: txResult.bidResult.currentPrice,
          bidCount: txResult.bidResult.bidCount,
          endTime: txResult.bidResult.endTime,
        });

        if (txResult.previousHighestBidderId && txResult.previousHighestBidderId !== bidderId) {
          this.realtimeGateway.sendOutbidNotice(txResult.previousHighestBidderId, {
            auctionId,
            previousBid: txResult.previousPrice,
            newPrice: txResult.bidResult.currentPrice,
          });
        }

        if (txResult.bidResult.extended) {
          this.realtimeGateway.broadcastAuctionExtended({
            auctionId,
            newEndTime: txResult.bidResult.endTime,
            reason: 'ANTI_SNIPING',
          });
        }

        this.metricsService?.incrementBids('accepted');
      }

      return txResult.bidResult;
    } catch (err) {
      this.metricsService?.incrementBids('rejected');
      throw err;
    }
  }

  async getBidHistory(auctionId: string, limit = 50): Promise<BidDto[]> {
    const bids = await this.prisma.bid.findMany({
      where: { auctionId },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        bidder: { select: { name: true } },
      },
    });

    return bids.map((b) => ({
      id: b.id,
      auctionId: b.auctionId,
      bidderId: b.bidderId,
      bidderName: b.bidder.name,
      amount: b.amount,
      createdAt: b.createdAt.toISOString(),
    }));
  }
}
