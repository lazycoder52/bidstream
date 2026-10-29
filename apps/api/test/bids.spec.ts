import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JwtService } from '@nestjs/jwt';

interface MockAuctionState {
  id: string;
  title: string;
  description: string;
  startingPrice: number;
  currentPrice: number;
  reservePrice: number | null;
  minIncrement: number;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  sellerId: string;
  winnerId: string | null;
  bidCount: number;
  startTime: Date;
  endTime: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MockBidRecord {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  createdAt: Date;
  bidder: { name: string };
}

interface MockIdempotencyRecord {
  id: string;
  key: string;
  target: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

describe('Bids Module (Integration)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const sellerId = '11111111-1111-1111-1111-111111111111';
  const bidder1Id = '22222222-2222-2222-2222-222222222222';
  const bidder2Id = '33333333-3333-3333-3333-333333333333';
  const auctionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  let sellerToken: string;
  let bidder1Token: string;
  let bidder2Token: string;

  let currentAuctionState: MockAuctionState;
  const mockBids: MockBidRecord[] = [];
  const mockIdempotencyKeys = new Map<string, MockIdempotencyRecord>();

  const resetState = () => {
    currentAuctionState = {
      id: auctionId,
      title: 'Rare Comic Book #1',
      description: 'First edition in near-mint condition.',
      startingPrice: 100,
      currentPrice: 100,
      reservePrice: null,
      minIncrement: 10,
      status: 'ACTIVE',
      sellerId: sellerId,
      winnerId: null,
      bidCount: 0,
      startTime: new Date(Date.now() - 3600000), // started 1 hour ago
      endTime: new Date(Date.now() + 3600000), // ends in 1 hour
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockBids.length = 0;
    mockIdempotencyKeys.clear();
  };

  const mockPrismaService = {
    user: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id === sellerId)
            return Promise.resolve({ id: sellerId, email: 'seller@example.com', role: 'SELLER' });
          if (where.id === bidder1Id)
            return Promise.resolve({ id: bidder1Id, email: 'bidder1@example.com', role: 'BUYER' });
          if (where.id === bidder2Id)
            return Promise.resolve({ id: bidder2Id, email: 'bidder2@example.com', role: 'BUYER' });
          return Promise.resolve(null);
        }),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === sellerId)
          return Promise.resolve({ id: sellerId, email: 'seller@example.com', role: 'SELLER' });
        if (id === bidder1Id)
          return Promise.resolve({ id: bidder1Id, email: 'bidder1@example.com', role: 'BUYER' });
        if (id === bidder2Id)
          return Promise.resolve({ id: bidder2Id, email: 'bidder2@example.com', role: 'BUYER' });
        return Promise.resolve(null);
      }),
    },
    auction: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === auctionId) return Promise.resolve(currentAuctionState);
        return Promise.resolve(null);
      }),
      update: jest.fn().mockImplementation(
        ({
          data,
        }: {
          data: {
            currentPrice?: number;
            winnerId?: string;
            endTime?: Date;
            bidCount?: { increment: number };
            version?: { increment: number };
          };
        }) => {
          if (data.currentPrice !== undefined) currentAuctionState.currentPrice = data.currentPrice;
          if (data.winnerId !== undefined) currentAuctionState.winnerId = data.winnerId;
          if (data.endTime !== undefined) currentAuctionState.endTime = data.endTime;
          if (data.bidCount?.increment) currentAuctionState.bidCount += data.bidCount.increment;
          if (data.version?.increment) currentAuctionState.version += data.version.increment;
          return Promise.resolve(currentAuctionState);
        },
      ),
    },
    bid: {
      create: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: { auctionId: string; bidderId: string; amount: number } }) => {
            const record: MockBidRecord = {
              id: `bid-${mockBids.length + 1}`,
              auctionId: data.auctionId,
              bidderId: data.bidderId,
              amount: data.amount,
              createdAt: new Date(),
              bidder: { name: data.bidderId === bidder1Id ? 'Bidder 1' : 'Bidder 2' },
            };
            mockBids.push(record);
            return Promise.resolve(record);
          },
        ),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(mockBids)),
    },
    idempotencyKey: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
        return Promise.resolve(mockIdempotencyKeys.get(where.key) || null);
      }),
      create: jest.fn().mockImplementation(({ data }: { data: MockIdempotencyRecord }) => {
        mockIdempotencyKeys.set(data.key, data);
        return Promise.resolve(data);
      }),
    },
    $queryRaw: jest.fn().mockImplementation(() => {
      return Promise.resolve([
        {
          id: currentAuctionState.id,
          status: currentAuctionState.status,
          current_price: currentAuctionState.currentPrice,
          min_increment: currentAuctionState.minIncrement,
          end_time: currentAuctionState.endTime,
          seller_id: currentAuctionState.sellerId,
          winner_id: currentAuctionState.winnerId,
          bid_count: currentAuctionState.bidCount,
          version: currentAuctionState.version,
        },
      ]);
    }),
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => {
        return cb(mockPrismaService);
      }),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  const mockLifecycleService = {
    scheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
    rescheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
    closeAuction: jest.fn().mockResolvedValue({ closed: true, winnerId: null }),
  };

  const mockRedisClient = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, 60000],
      ]),
    }),
    pexpire: jest.fn().mockResolvedValue(1),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .overrideProvider(LifecycleService)
      .useValue(mockLifecycleService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    const secret = process.env['JWT_ACCESS_SECRET'] as string;

    sellerToken = jwtService.sign(
      { sub: sellerId, email: 'seller@example.com', role: 'SELLER' },
      { secret },
    );
    bidder1Token = jwtService.sign(
      { sub: bidder1Id, email: 'bidder1@example.com', role: 'BUYER' },
      { secret },
    );
    bidder2Token = jwtService.sign(
      { sub: bidder2Id, email: 'bidder2@example.com', role: 'BUYER' },
      { secret },
    );
  });

  beforeEach(() => {
    resetState();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('rejects bids below the minimum increment (currentPrice + minIncrement)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .send({ amount: 105 })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('minimum required amount');
    expect(mockBids).toHaveLength(0);
  });

  it('rejects bids from the auction seller (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ amount: 120 })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Sellers are not permitted');
    expect(mockBids).toHaveLength(0);
  });

  it('accepts a valid bid and updates current price and bid count', async () => {
    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .send({ amount: 120 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.currentPrice).toBe(120);
    expect(res.body.data.bidCount).toBe(1);
    expect(res.body.data.bid.amount).toBe(120);
    expect(currentAuctionState.currentPrice).toBe(120);
    expect(currentAuctionState.winnerId).toBe(bidder1Id);
  });

  it('prevents user from bidding against themselves if already highest bidder (400)', async () => {
    currentAuctionState.winnerId = bidder1Id;
    currentAuctionState.currentPrice = 120;

    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .send({ amount: 140 })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('already hold the highest bid');
  });

  it('triggers anti-sniping extension when bid arrives in the final minute', async () => {
    currentAuctionState.endTime = new Date(Date.now() + 30000);

    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder2Token}`)
      .send({ amount: 150 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.extended).toBe(true);
    expect(mockLifecycleService.rescheduleAuctionClose).toHaveBeenCalled();
  });

  it('returns cached response when identical Idempotency-Key is provided', async () => {
    const idempotencyKey = 'idem-unique-key-12345';

    const firstRes = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 150 })
      .expect(201);

    expect(firstRes.body.success).toBe(true);
    const firstBidId = firstRes.body.data.bid.id;
    expect(mockBids).toHaveLength(1);

    const secondRes = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 150 })
      .expect(201);

    expect(secondRes.body.success).toBe(true);
    expect(secondRes.body.data.bid.id).toBe(firstBidId);
    expect(mockBids).toHaveLength(1);
  });

  it('rejects bids when auction has already expired (409)', async () => {
    currentAuctionState.endTime = new Date(Date.now() - 5000);

    const res = await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidder1Token}`)
      .send({ amount: 200 })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('already ended');
  });
});
