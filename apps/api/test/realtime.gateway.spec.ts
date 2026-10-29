import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BidPlacedEvent, AuctionExtendedEvent, AuctionClosedEvent } from '@bidstream/contracts';

describe('RealtimeGateway (Unit & Integration)', () => {
  let app: INestApplication;
  let gateway: RealtimeGateway;
  let client1: ClientSocket;
  let client2: ClientSocket;
  let jwtService: JwtService;

  const testAuctionId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const testUserId = '11111111-5555-6666-7777-888888888888';
  const lastBidId = '00000000-0000-0000-0000-000000000001';
  const replayedBidId = '00000000-0000-0000-0000-000000000002';

  const mockPrismaService = {
    bid: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === lastBidId) {
          return Promise.resolve({
            id: lastBidId,
            auctionId: testAuctionId,
            createdAt: new Date('2026-10-29T10:00:00Z'),
          });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation(() => {
        return Promise.resolve([
          {
            id: replayedBidId,
            auctionId: testAuctionId,
            bidderId: '22222222-0000-0000-0000-000000000002',
            amount: 150,
            createdAt: new Date('2026-10-29T10:01:00Z'),
            bidder: {
              id: '22222222-0000-0000-0000-000000000002',
              name: 'Replayed Bidder',
            },
          },
        ]);
      }),
    },
    auction: {
      findUnique: jest.fn().mockResolvedValue({
        id: testAuctionId,
        currentPrice: 150,
        bidCount: 2,
        endTime: new Date('2026-10-29T12:00:00Z'),
      }),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
      if (key === 'JWT_ACCESS_SECRET') return 'test_jwt_access_secret_for_testing';
      return defaultVal;
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        JwtService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    gateway = moduleFixture.get<RealtimeGateway>(RealtimeGateway);

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    const port = address.port;

    const token = await jwtService.signAsync(
      { sub: testUserId, email: 'test@example.com', role: 'BUYER' },
      { secret: 'test_jwt_access_secret_for_testing' },
    );

    client1 = Client(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token },
    });

    client2 = Client(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => client1.on('connect', () => resolve())),
      new Promise<void>((resolve) => client2.on('connect', () => resolve())),
    ]);
  });

  afterAll(async () => {
    client1.disconnect();
    client2.disconnect();
    await app.close();
  });

  it('performs high-precision server time synchronization', async () => {
    const clientSendTime = Date.now();

    const response = await new Promise<{
      clientSendTime: number;
      serverReceiveTime: number;
      serverSendTime: number;
    }>((resolve) => {
      client1.once('time:sync:response', (data) => resolve(data));
      client1.emit('time:sync:request', { clientSendTime });
    });

    const clientReceiveTime = Date.now();

    expect(response.clientSendTime).toBe(clientSendTime);
    expect(response.serverReceiveTime).toBeGreaterThanOrEqual(clientSendTime);
    expect(response.serverSendTime).toBeGreaterThanOrEqual(response.serverReceiveTime);
    expect(clientReceiveTime).toBeGreaterThanOrEqual(response.serverSendTime);

    // Calculate round-trip time and clock offset
    const roundTripTime = clientReceiveTime - clientSendTime;
    const serverTimeEstimate = response.serverReceiveTime + roundTripTime / 2;
    expect(roundTripTime).toBeGreaterThanOrEqual(0);
    expect(Math.abs(Date.now() - serverTimeEstimate)).toBeLessThan(500);
  });

  it('broadcasts bid:placed only to clients who joined the auction room', async () => {
    // client1 joins the auction room
    await new Promise<void>((resolve) => {
      client1.once('auction:joined', () => resolve());
      client1.emit('auction:join', { auctionId: testAuctionId });
    });

    // client2 has not joined the room
    let client2Received = false;
    client2.once('bid:placed', () => {
      client2Received = true;
    });

    const sampleBidEvent: BidPlacedEvent = {
      auctionId: testAuctionId,
      bid: {
        id: '11111111-2222-3333-4444-555555555555',
        auctionId: testAuctionId,
        bidderId: testUserId,
        bidderName: 'Test Bidder',
        amount: 120,
        createdAt: new Date().toISOString(),
      },
      currentPrice: 120,
      bidCount: 5,
      endTime: new Date(Date.now() + 600000).toISOString(),
    };

    const client1ReceivedPromise = new Promise<BidPlacedEvent>((resolve) => {
      client1.once('bid:placed', (data) => resolve(data));
    });

    gateway.broadcastBidPlaced(sampleBidEvent);

    const receivedEvent = await client1ReceivedPromise;
    expect(receivedEvent.bid.id).toBe('11111111-2222-3333-4444-555555555555');
    expect(receivedEvent.currentPrice).toBe(120);
    expect(client2Received).toBe(false);
  });

  it('sends personalized bid:outbid notice to authenticated user room', async () => {
    const outbidPromise = new Promise<{
      auctionId: string;
      previousBid: number;
      newPrice: number;
    }>((resolve) => {
      client1.once('bid:outbid', (data) => resolve(data));
    });

    gateway.sendOutbidNotice(testUserId, {
      auctionId: testAuctionId,
      previousBid: 120,
      newPrice: 130,
    });

    const outbidData = await outbidPromise;
    expect(outbidData.auctionId).toBe(testAuctionId);
    expect(outbidData.previousBid).toBe(120);
    expect(outbidData.newPrice).toBe(130);
  });

  it('replays missed bids from database when client provides lastBidId on join', async () => {
    const replayedBids: BidPlacedEvent[] = [];
    client2.on('bid:placed', (event) => {
      replayedBids.push(event);
    });

    const joinedPromise = new Promise<{
      auctionId: string;
      replayedCount: number;
    }>((resolve) => {
      client2.once('auction:joined', (data) => resolve(data));
    });

    client2.emit('auction:join', { auctionId: testAuctionId, lastBidId });

    const joinResult = await joinedPromise;

    expect(joinResult.auctionId).toBe(testAuctionId);
    expect(joinResult.replayedCount).toBe(1);
    expect(replayedBids).toHaveLength(1);
    expect(replayedBids[0]?.bid.id).toBe(replayedBidId);
    expect(replayedBids[0]?.bid.amount).toBe(150);
  });

  it('broadcasts auction:extended and auction:closed to room participants', async () => {
    const extendedPromise = new Promise<AuctionExtendedEvent>((resolve) => {
      client1.once('auction:extended', (data) => resolve(data));
    });
    const closedPromise = new Promise<AuctionClosedEvent>((resolve) => {
      client1.once('auction:closed', (data) => resolve(data));
    });

    const extendedEvent: AuctionExtendedEvent = {
      auctionId: testAuctionId,
      newEndTime: new Date(Date.now() + 120000).toISOString(),
      reason: 'ANTI_SNIPING',
    };

    const closedEvent: AuctionClosedEvent = {
      auctionId: testAuctionId,
      winnerId: testUserId,
      winnerName: 'Test Winner',
      finalPrice: 200,
      status: 'ENDED',
    };

    gateway.broadcastAuctionExtended(extendedEvent);
    gateway.broadcastAuctionClosed(closedEvent);

    const [recExtended, recClosed] = await Promise.all([extendedPromise, closedPromise]);
    expect(recExtended.reason).toBe('ANTI_SNIPING');
    expect(recClosed.status).toBe('ENDED');
    expect(recClosed.winnerId).toBe(testUserId);
  });
});
