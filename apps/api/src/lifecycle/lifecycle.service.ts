import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

export interface AuctionClosePayload {
  auctionId: string;
}

interface LockedAuctionRow {
  id: string;
  status: string;
  current_price: number;
  reserve_price: number | null;
  end_time: Date;
  seller_id: string;
  winner_id: string | null;
}

@Injectable()
export class LifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LifecycleService.name);
  private queue: Queue<AuctionClosePayload> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    this.queue = new Queue<AuctionClosePayload>('auction-close', {
      connection: {
        host,
        port,
        password: password || undefined,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  async scheduleAuctionClose(auctionId: string, endTime: Date): Promise<void> {
    if (!this.queue) return;

    const delay = Math.max(0, endTime.getTime() - Date.now());
    const jobId = `auction-close-${auctionId}`;

    try {
      // Remove any existing job with this ID
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
      }

      await this.queue.add(
        'close',
        { auctionId },
        {
          jobId,
          delay,
        },
      );
      this.logger.debug(`Scheduled close for auction ${auctionId} with delay ${delay}ms`);
    } catch (err) {
      this.logger.error(`Failed to schedule close for auction ${auctionId}`, err);
    }
  }

  async rescheduleAuctionClose(auctionId: string, newEndTime: Date): Promise<void> {
    await this.scheduleAuctionClose(auctionId, newEndTime);
  }

  async closeAuction(auctionId: string): Promise<{ closed: boolean; winnerId: string | null }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedAuctionRow[]>`
        SELECT id, status, current_price, reserve_price, end_time, seller_id, winner_id
        FROM auctions
        WHERE id = ${auctionId}::uuid
        FOR UPDATE;
      `;

      const auction = rows[0];
      if (!auction) {
        return { closed: false, winnerId: null, finalPrice: 0 };
      }

      if (auction.status !== 'ACTIVE') {
        return {
          closed: false,
          winnerId: auction.winner_id,
          finalPrice: Number(auction.current_price),
        };
      }

      const now = new Date();
      if (now < auction.end_time) {
        // Auction was extended and end_time is in the future
        return {
          closed: false,
          winnerId: auction.winner_id,
          finalPrice: Number(auction.current_price),
        };
      }

      const highestBid = await tx.bid.findFirst({
        where: { auctionId },
        orderBy: { amount: 'desc' },
      });

      let finalWinnerId: string | null = null;
      if (highestBid) {
        if (auction.reserve_price === null || highestBid.amount >= auction.reserve_price) {
          finalWinnerId = highestBid.bidderId;
        }
      }

      await tx.auction.update({
        where: { id: auctionId },
        data: {
          status: 'ENDED',
          winnerId: finalWinnerId,
        },
      });

      this.logger.log(
        `Auction ${auctionId} closed successfully. Winner: ${finalWinnerId ?? 'No winner (reserve not met or no bids)'}`,
      );

      return {
        closed: true,
        winnerId: finalWinnerId,
        finalPrice: Number(auction.current_price),
      };
    });

    if (result.closed) {
      let winnerName: string | null = null;
      if (result.winnerId) {
        try {
          const winner = await this.prisma.user.findUnique({
            where: { id: result.winnerId },
            select: { name: true },
          });
          winnerName = winner?.name ?? null;
        } catch {
          winnerName = null;
        }
      }

      this.realtimeGateway.broadcastAuctionClosed({
        auctionId,
        winnerId: result.winnerId,
        winnerName,
        finalPrice: result.finalPrice,
        status: 'ENDED',
      });
    }

    return { closed: result.closed, winnerId: result.winnerId };
  }

  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
