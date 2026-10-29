import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BidPlacedEvent,
  OutbidNoticeEvent,
  AuctionExtendedEvent,
  AuctionClosedEvent,
  AuctionJoinSchema,
  AuctionJoinPayload,
  AuctionLeaveSchema,
  AuctionLeavePayload,
  TimeSyncRequest,
  TimeSyncRequestSchema,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@bidstream/contracts';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.logger.log('RealtimeGateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') as
          string | undefined) ||
        (client.handshake.query?.token as string | undefined);

      if (token) {
        const secret = this.configService.get<string>('JWT_ACCESS_SECRET') || 'default_jwt_secret';
        const payload = await this.jwtService.verifyAsync(token, { secret });
        if (payload?.sub) {
          const userRoom = `user:${payload.sub}`;
          await client.join(userRoom);
          client.data.userId = payload.sub;
          this.logger.debug(
            `Client ${client.id} authenticated as user ${payload.sub} and joined ${userRoom}`,
          );
        }
      }
    } catch {
      // Unauthenticated client can still observe public auctions
      this.logger.debug(`Client ${client.id} connected anonymously or token invalid`);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('auction:join')
  async handleJoinAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AuctionJoinPayload,
  ): Promise<{ status: 'ok'; replayedCount: number } | void> {
    const parsed = AuctionJoinSchema.safeParse(payload);
    if (!parsed.success) {
      client.emit('error', { message: 'Invalid auction join payload' });
      return;
    }

    const { auctionId, lastBidId } = parsed.data;
    const room = `auction:${auctionId}`;
    await client.join(room);

    let replayedCount = 0;
    if (lastBidId) {
      try {
        const lastBid = await this.prisma.bid.findUnique({
          where: { id: lastBidId },
          select: { createdAt: true, auctionId: true },
        });

        if (lastBid && lastBid.auctionId === auctionId) {
          const missedBids = await this.prisma.bid.findMany({
            where: {
              auctionId,
              createdAt: { gt: lastBid.createdAt },
            },
            include: {
              bidder: {
                select: { id: true, name: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          });

          const auction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
            select: { currentPrice: true, bidCount: true, endTime: true },
          });

          let runningCount = (auction?.bidCount ?? 0) - missedBids.length;

          for (const bid of missedBids) {
            runningCount++;
            client.emit('bid:placed', {
              auctionId,
              bid: {
                id: bid.id,
                auctionId: bid.auctionId,
                bidderId: bid.bidderId,
                bidderName: bid.bidder.name,
                amount: Number(bid.amount),
                createdAt: bid.createdAt.toISOString(),
              },
              currentPrice: Number(bid.amount),
              bidCount: runningCount,
              endTime: auction?.endTime.toISOString() ?? new Date().toISOString(),
            });
            replayedCount++;
          }
        }
      } catch (err) {
        this.logger.error(
          `Error replaying bids for auction ${auctionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    client.emit('auction:joined', { auctionId, replayedCount });
    return { status: 'ok', replayedCount };
  }

  @SubscribeMessage('auction:leave')
  async handleLeaveAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AuctionLeavePayload,
  ): Promise<void> {
    const parsed = AuctionLeaveSchema.safeParse(payload);
    if (!parsed.success) return;
    await client.leave(`auction:${parsed.data.auctionId}`);
  }

  @SubscribeMessage('time:sync:request')
  handleTimeSync(@ConnectedSocket() client: Socket, @MessageBody() payload: TimeSyncRequest): void {
    const parsed = TimeSyncRequestSchema.safeParse(payload);
    if (!parsed.success) {
      client.emit('error', { message: 'Invalid time sync payload' });
      return;
    }

    const serverReceiveTime = Date.now();
    const serverSendTime = Date.now();

    client.emit('time:sync:response', {
      clientSendTime: parsed.data.clientSendTime,
      serverReceiveTime,
      serverSendTime,
    });
  }

  // --- Broadcast Methods for API services ---

  broadcastBidPlaced(event: BidPlacedEvent): void {
    if (!this.server) return;
    this.server.to(`auction:${event.auctionId}`).emit('bid:placed', event);
  }

  sendOutbidNotice(userId: string, event: OutbidNoticeEvent): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('bid:outbid', event);
  }

  broadcastAuctionExtended(event: AuctionExtendedEvent): void {
    if (!this.server) return;
    this.server.to(`auction:${event.auctionId}`).emit('auction:extended', event);
  }

  broadcastAuctionClosed(event: AuctionClosedEvent): void {
    if (!this.server) return;
    this.server.to(`auction:${event.auctionId}`).emit('auction:closed', event);
  }
}
