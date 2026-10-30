import { PrismaClient } from '@prisma/client';
import { BidsService } from '../src/bids/bids.service';
import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { PrismaService } from '../src/prisma/prisma.service';

describe('High-Concurrency Bidding Engine (Real PostgreSQL)', () => {
  let prisma: PrismaClient;
  let bidsService: BidsService;
  let isPostgresAvailable = false;

  const testSuffix = Date.now().toString();
  let sellerId: string;
  let auctionId: string;
  const bidderIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url:
            process.env['DATABASE_URL'] ||
            'postgresql://bidstream:bidstream_pass@localhost:5432/bidstream_db?schema=public',
        },
      },
    });

    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      isPostgresAvailable = true;
    } catch (err) {
      if (process.env.CI === 'true' || process.env['CI'] === 'true') {
        throw new Error(
          `Real PostgreSQL is required in CI for bidding concurrency suite, but database connection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.warn(
        'Real PostgreSQL is not reachable in this environment. Skipping live concurrency suite.',
      );
      isPostgresAvailable = false;
      return;
    }

    const mockLifecycleService = {
      scheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
      rescheduleAuctionClose: jest.fn().mockResolvedValue(undefined),
      closeAuction: jest.fn().mockResolvedValue({ closed: true, winnerId: null }),
    } as unknown as LifecycleService;

    const mockRealtimeGateway = {
      broadcastBidPlaced: jest.fn(),
      sendOutbidNotice: jest.fn(),
      broadcastAuctionExtended: jest.fn(),
      broadcastAuctionClosed: jest.fn(),
    } as unknown as RealtimeGateway;

    bidsService = new BidsService(
      prisma as unknown as PrismaService,
      mockLifecycleService,
      mockRealtimeGateway,
    );

    // Clean up any old test data and seed fresh records
    const seller = await prisma.user.create({
      data: {
        email: `seller-${testSuffix}@example.com`,
        passwordHash: 'dummyhash',
        name: 'Concurrency Seller',
        role: 'SELLER',
      },
    });
    sellerId = seller.id;

    for (let i = 0; i < 20; i++) {
      const bidder = await prisma.user.create({
        data: {
          email: `bidder-${i}-${testSuffix}@example.com`,
          passwordHash: 'dummyhash',
          name: `Bidder ${i}`,
          role: 'BUYER',
        },
      });
      bidderIds.push(bidder.id);
    }

    const auction = await prisma.auction.create({
      data: {
        title: `Concurrency Stress Auction ${testSuffix}`,
        description: 'Subjected to 200+ simultaneous bids under SELECT ... FOR UPDATE',
        startingPrice: 100,
        currentPrice: 100,
        minIncrement: 5,
        status: 'ACTIVE',
        sellerId,
        startTime: new Date(Date.now() - 60000), // started 1 min ago
        endTime: new Date(Date.now() + 3600000), // ends in 1 hour
      },
    });
    auctionId = auction.id;
  }, 30000);

  afterAll(async () => {
    if (isPostgresAvailable && prisma) {
      try {
        if (auctionId) {
          await prisma.bid.deleteMany({ where: { auctionId } });
          await prisma.idempotencyKey.deleteMany({
            where: { target: `POST /auctions/${auctionId}/bids` },
          });
          await prisma.auction.delete({ where: { id: auctionId } }).catch(() => {});
        }
        if (sellerId) {
          await prisma.user.delete({ where: { id: sellerId } }).catch(() => {});
        }
        for (const bid of bidderIds) {
          await prisma.user.delete({ where: { id: bid } }).catch(() => {});
        }
      } catch {
        // Cleanup best effort
      }
      await prisma.$disconnect();
    }
  });

  it('correctly serializes 200 parallel bids without deadlocks or lost updates', async () => {
    if (!isPostgresAvailable) {
      if (process.env.CI === 'true' || process.env['CI'] === 'true') {
        throw new Error(
          'Real PostgreSQL is required in CI for 200-bid concurrency test, but was not available.',
        );
      }
      expect(true).toBe(true);
      return;
    }

    const CONCURRENCY_COUNT = 200;
    const idempotencyKeyForDuplicates = `idem-storm-${testSuffix}`;

    // Prepare 200 bid requests
    // Mix of varying amounts, some below increment, some duplicate amounts, and 20 identical idempotency keys
    const bidPromises = Array.from({ length: CONCURRENCY_COUNT }, (_, index) => {
      const bidderId = bidderIds[index % bidderIds.length]!;
      // Increasing bid amounts interspersed with some identical amounts to test collision
      const amount = 100 + 5 * Math.floor(index / 2) + (index % 3);

      // Give 20 requests the exact same idempotency key to test replay under concurrency
      const idempotencyKey =
        index < 20 ? idempotencyKeyForDuplicates : `idem-${testSuffix}-${index}`;

      return bidsService
        .placeBid(auctionId, bidderId, { amount }, idempotencyKey)
        .then((res) => ({ status: 'fulfilled' as const, value: res }))
        .catch((err) => ({ status: 'rejected' as const, reason: err }));
    });

    // Fire all 200 promises concurrently
    const results = await Promise.all(bidPromises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // 1. Assert zero deadlocks (Postgres error code 40P01)
    const deadlocks = rejected.filter((r) => {
      const reason = String(r.reason);
      return reason.includes('deadlock detected') || reason.includes('40P01');
    });
    expect(deadlocks).toHaveLength(0);

    // 2. Fetch all accepted bids from database
    const savedBids = await prisma.bid.findMany({
      where: { auctionId },
      orderBy: { createdAt: 'asc' },
    });

    expect(savedBids.length).toBeGreaterThan(0);

    // 3. Assert strictly increasing sequence of accepted bids
    for (let i = 1; i < savedBids.length; i++) {
      const prev = savedBids[i - 1]!;
      const curr = savedBids[i]!;
      expect(curr.amount).toBeGreaterThan(prev.amount);
      expect(curr.amount).toBeGreaterThanOrEqual(prev.amount + 5);
    }

    // 4. Assert correct final price and no lost updates on Auction record
    const finalAuction = await prisma.auction.findUniqueOrThrow({
      where: { id: auctionId },
    });

    const highestBidAmount = savedBids[savedBids.length - 1]!.amount;
    expect(finalAuction.currentPrice).toBe(highestBidAmount);
    expect(finalAuction.bidCount).toBe(savedBids.length);

    // 5. Assert duplicate idempotency key returned identical bid and did not insert duplicates
    const firstFulfilledVal = fulfilled[0]?.value as { bid: { amount: number } } | undefined;
    const duplicateBidsInDb = savedBids.filter((b) => b.amount === firstFulfilledVal?.bid?.amount);
    expect(duplicateBidsInDb).toHaveLength(1);
  }, 45000);

  it('correctly handles 20 concurrent parallel requests with the identical idempotency key', async () => {
    if (!isPostgresAvailable) {
      if (process.env.CI === 'true' || process.env['CI'] === 'true') {
        throw new Error(
          'Real PostgreSQL is required in CI for concurrent idempotency test, but was not available.',
        );
      }
      expect(true).toBe(true);
      return;
    }

    const testAuction = await prisma.auction.create({
      data: {
        title: `Concurrent Idempotent Auction ${testSuffix}`,
        description: 'Asserting exact replay and single price increment under parallel fire',
        startingPrice: 50,
        currentPrice: 50,
        minIncrement: 5,
        status: 'ACTIVE',
        sellerId,
        startTime: new Date(Date.now() - 60000),
        endTime: new Date(Date.now() + 3600000),
      },
    });

    const parallelIdempotencyKey = `parallel-key-${testSuffix}-${Date.now()}`;
    const bidderId = bidderIds[0]!;
    const PARALLEL_REQUEST_COUNT = 20;
    const bidAmount = 60;

    // Fire 20 simultaneous identical requests with the SAME Idempotency-Key
    const requests = Array.from({ length: PARALLEL_REQUEST_COUNT }, () =>
      bidsService
        .placeBid(testAuction.id, bidderId, { amount: bidAmount }, parallelIdempotencyKey)
        .then((res) => ({ status: 'fulfilled' as const, value: res }))
        .catch((err) => ({ status: 'rejected' as const, reason: err })),
    );

    const results = await Promise.all(requests);

    // 1. Assert all 20 requests succeeded
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(PARALLEL_REQUEST_COUNT);

    // 2. Assert all responses return the exact same stored response
    const firstResponse = fulfilled[0]!.value;
    for (const res of fulfilled) {
      expect(res.value.bid.id).toBe(firstResponse.bid.id);
      expect(res.value.bid.amount).toBe(firstResponse.bid.amount);
      expect(res.value.bid.bidderId).toBe(bidderId);
      expect(new Date(res.value.bid.createdAt).getTime()).toBe(
        new Date(firstResponse.bid.createdAt).getTime(),
      );
      expect(res.value.currentPrice).toBe(bidAmount);
      expect(res.value.bidCount).toBe(1);
    }

    // 3. Assert exactly one bid row is created for that key
    const bidsInDb = await prisma.bid.findMany({
      where: { auctionId: testAuction.id },
    });
    expect(bidsInDb).toHaveLength(1);
    expect(bidsInDb[0]!.id).toBe(firstResponse.bid.id);
    expect(bidsInDb[0]!.amount).toBe(bidAmount);

    // 4. Assert currentPrice moves exactly once (from 50 to 60)
    const finalAuctionState = await prisma.auction.findUniqueOrThrow({
      where: { id: testAuction.id },
    });
    expect(finalAuctionState.currentPrice).toBe(bidAmount);
    expect(finalAuctionState.bidCount).toBe(1);

    // Clean up test auction data
    await prisma.bid.deleteMany({ where: { auctionId: testAuction.id } });
    await prisma.idempotencyKey.deleteMany({
      where: { target: `POST /auctions/${testAuction.id}/bids` },
    });
    await prisma.auction.delete({ where: { id: testAuction.id } }).catch(() => {});
  }, 30000);
});
