import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { SweeperService } from '../src/lifecycle/sweeper.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

interface MockAuctionRecord {
  id: string;
  status: 'ACTIVE' | 'ENDED' | 'DRAFT' | 'CANCELLED';
  currentPrice: number;
  reservePrice: number | null;
  endTime: Date;
  sellerId: string;
  winnerId: string | null;
}

interface MockBidRecord {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
}

describe('Lifecycle & Closing Engine (Unit/Integration)', () => {
  let lifecycleService: LifecycleService;
  let sweeperService: SweeperService;

  const auctionId = 'cccccccc-dddd-eeee-ffff-000000000000';
  let mockAuction: MockAuctionRecord;
  let mockHighestBid: MockBidRecord | null;
  let lockPromise = Promise.resolve();

  const mockPrismaService = {
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => {
        // Simulate row-level exclusive lock on the auction
        const prev = lockPromise;
        let release: () => void;
        lockPromise = new Promise((resolve) => {
          release = resolve;
        });
        await prev;
        try {
          return await cb(mockPrismaService);
        } finally {
          release!();
        }
      }),
    $queryRaw: jest.fn().mockImplementation(() => {
      if (!mockAuction) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: mockAuction.id,
          status: mockAuction.status,
          current_price: mockAuction.currentPrice,
          reserve_price: mockAuction.reservePrice,
          end_time: mockAuction.endTime,
          seller_id: mockAuction.sellerId,
          winner_id: mockAuction.winnerId,
        },
      ]);
    }),
    bid: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockHighestBid)),
    },
    auction: {
      update: jest
        .fn()
        .mockImplementation(
          ({
            data,
          }: {
            data: { status?: 'ACTIVE' | 'ENDED'; winnerId?: string | null };
          }) => {
            if (data.status) mockAuction.status = data.status;
            if (data.winnerId !== undefined) mockAuction.winnerId = data.winnerId;
            return Promise.resolve(mockAuction);
          },
        ),
    },
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((_key: string, def: unknown) => def),
  };

  beforeEach(() => {
    mockAuction = {
      id: auctionId,
      status: 'ACTIVE',
      currentPrice: 250,
      reservePrice: 200,
      endTime: new Date(Date.now() - 10000), // expired 10s ago
      sellerId: 'seller-id',
      winnerId: null,
    };
    mockHighestBid = {
      id: 'bid-99',
      auctionId,
      bidderId: 'winner-bidder-id',
      amount: 250,
    };
    lockPromise = Promise.resolve();
    jest.clearAllMocks();

    lifecycleService = new LifecycleService(
      mockPrismaService as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );
    sweeperService = new SweeperService(
      mockPrismaService as unknown as PrismaService,
      lifecycleService,
    );
  });

  afterEach(() => {
    sweeperService.onModuleDestroy();
  });

  it('closes an expired active auction and awards winner', async () => {
    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(true);
    expect(result.winnerId).toBe('winner-bidder-id');
    expect(mockAuction.status).toBe('ENDED');
    expect(mockAuction.winnerId).toBe('winner-bidder-id');
  });

  it('does not close an auction whose end_time is still in the future', async () => {
    mockAuction.endTime = new Date(Date.now() + 60000); // 1 minute in future

    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(false);
    expect(mockAuction.status).toBe('ACTIVE');
  });

  it('sets winner to null if reserve price was not met', async () => {
    mockAuction.reservePrice = 500; // current price is 250, reserve is 500

    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(true);
    expect(result.winnerId).toBeNull();
    expect(mockAuction.winnerId).toBeNull();
  });

  it('idempotently handles racing workers attempting to close the same auction', async () => {
    const [result1, result2] = await Promise.all([
      lifecycleService.closeAuction(auctionId),
      lifecycleService.closeAuction(auctionId),
    ]);

    const closedCount = (result1.closed ? 1 : 0) + (result2.closed ? 1 : 0);
    expect(closedCount).toBe(1);
    expect(mockAuction.status).toBe('ENDED');
  });

  it('sweeper detects overdue active auctions and invokes close', async () => {
    mockPrismaService.$queryRaw.mockResolvedValueOnce([{ id: auctionId }]);

    const sweptCount = await sweeperService.sweepOverdueAuctions();

    expect(sweptCount).toBe(1);
    expect(mockAuction.status).toBe('ENDED');
  });
});
