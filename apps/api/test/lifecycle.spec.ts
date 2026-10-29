import { LifecycleService } from '../src/lifecycle/lifecycle.service';
import { SweeperService } from '../src/lifecycle/sweeper.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
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
      findFirst: jest.fn().mockImplementation(() => {
        return Promise.resolve(mockHighestBid);
      }),
    },
    auction: {
      update: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: { status?: 'ENDED'; winnerId?: string | null } }) => {
            if (data.status) mockAuction.status = data.status;
            if (data.winnerId !== undefined) mockAuction.winnerId = data.winnerId;
            return Promise.resolve(mockAuction);
          },
        ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Winner User' }),
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
    mockAuction = {
      id: auctionId,
      status: 'ACTIVE',
      currentPrice: 200,
      reservePrice: 200,
      endTime: new Date(Date.now() - 1000), // Ended 1s ago
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

  it('closes an expired active auction and awards winner', async () => {
    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(true);
    expect(result.winnerId).toBe('winner-bidder-id');
    expect(mockAuction.status).toBe('ENDED');
    expect(mockAuction.winnerId).toBe('winner-bidder-id');
    expect(mockRealtimeGateway.broadcastAuctionClosed).toHaveBeenCalledWith(
      expect.objectContaining({
        auctionId,
        winnerId: 'winner-bidder-id',
        status: 'ENDED',
      }),
    );
  });

  it('does not close auction if end_time is still in the future', async () => {
    mockAuction.endTime = new Date(Date.now() + 60000); // 1 minute in the future

    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(false);
    expect(mockAuction.status).toBe('ACTIVE');
  });

  it('does not award winner if reserve price is not met', async () => {
    mockAuction.reservePrice = 500;
    mockHighestBid = {
      id: 'bid-1',
      auctionId,
      bidderId: 'low-bidder',
      amount: 250,
    };

    const result = await lifecycleService.closeAuction(auctionId);

    expect(result.closed).toBe(true);
    expect(result.winnerId).toBeNull();
    expect(mockAuction.status).toBe('ENDED');
    expect(mockAuction.winnerId).toBeNull();
  });

  it('handles concurrent closing workers idempotently without double-ending', async () => {
    // Two workers attempt to close the exact same auction at the exact same millisecond
    const [w1, w2] = await Promise.all([
      lifecycleService.closeAuction(auctionId),
      lifecycleService.closeAuction(auctionId),
    ]);

    // Exactly one should perform the transition, both return cleanly
    const closedCount = (w1.closed ? 1 : 0) + (w2.closed ? 1 : 0);
    expect(closedCount).toBe(1);
    expect(mockAuction.status).toBe('ENDED');
  });

  it('sweeper finds and triggers close on overdue auctions', async () => {
    mockPrismaService.$queryRaw.mockResolvedValueOnce([{ id: auctionId }]);
    const closeSpy = jest.spyOn(lifecycleService, 'closeAuction').mockResolvedValueOnce({
      closed: true,
      winnerId: 'winner-bidder-id',
    });

    await sweeperService.sweepOverdueAuctions();

    expect(closeSpy).toHaveBeenCalledWith(auctionId);
  });
});
