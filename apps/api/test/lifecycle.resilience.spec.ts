import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { SweeperService } from '../src/lifecycle/sweeper.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { ConfigService } from '@nestjs/config';

describe('Lifecycle Resilience: Concurrent Workers & Redis Flush Recovery', () => {
  let lifecycleService: LifecycleService;
  let sweeperService: SweeperService;

  const mockAuctions = new Map<
    string,
    {
      id: string;
      status: 'ACTIVE' | 'ENDED';
      currentPrice: number;
      reservePrice: number | null;
      endTime: Date;
      sellerId: string;
      winnerId: string | null;
    }
  >();

  const mockBids = new Map<
    string,
    {
      id: string;
      auctionId: string;
      bidderId: string;
      amount: number;
    }
  >();

  let lockQueue: Promise<void> = Promise.resolve();

  const mockRealtimeGateway = {
    broadcastBidPlaced: jest.fn(),
    sendOutbidNotice: jest.fn(),
    broadcastAuctionExtended: jest.fn(),
    broadcastAuctionClosed: jest.fn(),
  } as unknown as RealtimeGateway;

  const mockPrismaService = {
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => {
        // Simulate serial transaction queue for row-level locking
        const currentLock = lockQueue;
        let releaseLock: () => void;
        lockQueue = new Promise((resolve) => {
          releaseLock = resolve;
        });
        await currentLock;
        try {
          return await cb(mockPrismaService);
        } finally {
          releaseLock!();
        }
      }),
    $queryRaw: jest
      .fn()
      .mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join('?');
        if (query.includes('FROM auctions') && query.includes('WHERE id =')) {
          const id = values[0] as string;
          const auction = mockAuctions.get(id);
          if (!auction) return Promise.resolve([]);
          return Promise.resolve([
            {
              id: auction.id,
              status: auction.status,
              current_price: auction.currentPrice,
              reserve_price: auction.reservePrice,
              end_time: auction.endTime,
              seller_id: auction.sellerId,
              winner_id: auction.winnerId,
            },
          ]);
        }
        if (query.includes("status = 'ACTIVE' AND end_time <= NOW()")) {
          const overdue = Array.from(mockAuctions.values())
            .filter((a) => a.status === 'ACTIVE' && a.endTime <= new Date())
            .map((a) => ({ id: a.id }));
          return Promise.resolve(overdue);
        }
        return Promise.resolve([]);
      }),
    bid: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { auctionId: string } }) => {
        const bid = mockBids.get(where.auctionId);
        return Promise.resolve(bid || null);
      }),
    },
    auction: {
      update: jest
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: { status: 'ENDED'; winnerId?: string | null };
          }) => {
            const auction = mockAuctions.get(where.id);
            if (auction) {
              auction.status = data.status;
              if (data.winnerId !== undefined) auction.winnerId = data.winnerId;
            }
            return Promise.resolve(auction);
          },
        ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Resilient Winner' }),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultVal: unknown) => {
      if (key === 'REDIS_HOST') return 'localhost';
      if (key === 'REDIS_PORT') return 6379;
      return defaultVal;
    }),
  };

  beforeEach(() => {
    mockAuctions.clear();
    mockBids.clear();
    lockQueue = Promise.resolve();
    jest.clearAllMocks();

    lifecycleService = new LifecycleService(
      mockPrismaService as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
      mockRealtimeGateway,
    );
    sweeperService = new SweeperService(
      mockPrismaService as unknown as PrismaService,
      lifecycleService,
    );
  });

  afterEach(() => {
    sweeperService.onModuleDestroy();
  });

  it('proves two concurrent close workers racing on multiple auctions close each auction exactly once', async () => {
    // Seed 10 overdue auctions
    const auctionIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `auction-race-${i}`;
      auctionIds.push(id);
      mockAuctions.set(id, {
        id,
        status: 'ACTIVE',
        currentPrice: 100 + i * 10,
        reservePrice: 100,
        endTime: new Date(Date.now() - 5000), // Ended 5s ago
        sellerId: 'seller-id',
        winnerId: null,
      });
      mockBids.set(id, {
        id: `bid-${i}`,
        auctionId: id,
        bidderId: `winner-${i}`,
        amount: 150 + i * 10,
      });
    }

    // Worker 1 and Worker 2 fire closeAuction concurrently on all 10 auctions
    const worker1Promises = auctionIds.map((id) => lifecycleService.closeAuction(id));
    const worker2Promises = auctionIds.map((id) => lifecycleService.closeAuction(id));

    const [resultsWorker1, resultsWorker2] = await Promise.all([
      Promise.all(worker1Promises),
      Promise.all(worker2Promises),
    ]);

    // For each auction, exactly one worker must have performed the closure (closed: true)
    for (let i = 0; i < 10; i++) {
      const w1 = resultsWorker1[i]!;
      const w2 = resultsWorker2[i]!;
      const totalClosed = (w1.closed ? 1 : 0) + (w2.closed ? 1 : 0);
      expect(totalClosed).toBe(1);

      const auction = mockAuctions.get(auctionIds[i]!)!;
      expect(auction.status).toBe('ENDED');
      expect(auction.winnerId).toBe(`winner-${i}`);
    }

    // Realtime broadcast should have fired exactly 10 times (once per auction)
    expect(mockRealtimeGateway.broadcastAuctionClosed).toHaveBeenCalledTimes(10);
  });

  it('recovers and closes overdue auctions via Sweeper after simulated Redis flush/job eviction', async () => {
    // Simulate BullMQ queue being flushed or wiped: delayed jobs lost
    // Active auctions remain overdue in PostgreSQL
    const lostAuctionId = 'auction-redis-flushed-1';
    mockAuctions.set(lostAuctionId, {
      id: lostAuctionId,
      status: 'ACTIVE',
      currentPrice: 300,
      reservePrice: null,
      endTime: new Date(Date.now() - 30000), // Ended 30s ago while Redis was down
      sellerId: 'seller-2',
      winnerId: null,
    });
    mockBids.set(lostAuctionId, {
      id: 'bid-recovery',
      auctionId: lostAuctionId,
      bidderId: 'recovery-bidder',
      amount: 450,
    });

    // Sweeper tick executes
    await sweeperService.sweepOverdueAuctions();

    const recoveredAuction = mockAuctions.get(lostAuctionId)!;
    expect(recoveredAuction.status).toBe('ENDED');
    expect(recoveredAuction.winnerId).toBe('recovery-bidder');
    expect(mockRealtimeGateway.broadcastAuctionClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        auctionId: lostAuctionId,
        winnerId: 'recovery-bidder',
        status: 'ENDED',
      }),
    );
  });
});
