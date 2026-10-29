import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSocketStore } from './socket.store';
import { auctionsApi, ApiClientError } from '@/lib/api-client';

describe('useSocketStore (Live Bidding & Optimistic Rollback)', () => {
  const auctionId = 'aaaaaaaa-1111-2222-3333-444444444444';
  const currentUser = {
    id: 'user-1111-2222-3333-444444444444',
    name: 'Optimistic Tester',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useSocketStore.setState({
      socket: null,
      status: 'disconnected',
      serverTimeOffset: 0,
      currentAuctionId: null,
      activeBids: [],
      currentPrice: 0,
      bidCount: 0,
      endTime: null,
      isClosed: false,
      winnerId: null,
      outbidNotice: null,
      announcement: null,
    });
  });

  it('populates initial room state on joinAuctionRoom', () => {
    const initialBid = {
      id: 'bid-1',
      auctionId,
      bidderId: 'other-user',
      bidderName: 'Other Bidder',
      amount: 100,
      createdAt: new Date().toISOString(),
    };

    useSocketStore.getState().joinAuctionRoom(auctionId, {
      bids: [initialBid],
      price: 100,
      bidCount: 1,
      endTime: new Date(Date.now() + 3600000).toISOString(),
      isClosed: false,
    });

    const state = useSocketStore.getState();
    expect(state.currentAuctionId).toBe(auctionId);
    expect(state.currentPrice).toBe(100);
    expect(state.bidCount).toBe(1);
    expect(state.activeBids).toHaveLength(1);
  });

  it('applies optimistic bid immediately and reconciles on server acceptance', async () => {
    useSocketStore.setState({
      currentAuctionId: auctionId,
      currentPrice: 100,
      bidCount: 1,
      activeBids: [],
    });

    const serverBidResult = {
      bid: {
        id: 'real-bid-id-from-db',
        auctionId,
        bidderId: currentUser.id,
        bidderName: currentUser.name,
        amount: 110,
        createdAt: new Date().toISOString(),
      },
      currentPrice: 110,
      bidCount: 2,
      endTime: new Date(Date.now() + 3600000).toISOString(),
      extended: false,
    };

    vi.spyOn(auctionsApi, 'placeBid').mockResolvedValue(serverBidResult);

    await useSocketStore.getState().placeOptimisticBid(auctionId, 110, currentUser);

    const state = useSocketStore.getState();
    expect(state.currentPrice).toBe(110);
    expect(state.bidCount).toBe(2);
    expect(state.activeBids).toHaveLength(1);
    expect(state.activeBids[0]?.id).toBe('real-bid-id-from-db');
    expect(state.announcement).toContain('successfully accepted');
  });

  it('rolls back optimistic bid and restores state when server rejects with 409 Conflict', async () => {
    const initialBid = {
      id: 'existing-bid-id',
      auctionId,
      bidderId: 'prior-bidder',
      amount: 100,
      createdAt: new Date().toISOString(),
    };

    useSocketStore.setState({
      currentAuctionId: auctionId,
      currentPrice: 100,
      bidCount: 1,
      activeBids: [initialBid],
    });

    // Mock 409 Conflict (e.g. outbid by concurrent bidder)
    vi.spyOn(auctionsApi, 'placeBid').mockRejectedValue(
      new ApiClientError(409, 'Bid amount 105 is below the minimum required increment'),
    );

    // Attempt placing bid of 105
    await expect(
      useSocketStore.getState().placeOptimisticBid(auctionId, 105, currentUser),
    ).rejects.toThrow(ApiClientError);

    // Assert that the state was strictly rolled back
    const state = useSocketStore.getState();
    expect(state.currentPrice).toBe(100);
    expect(state.bidCount).toBe(1);
    expect(state.activeBids).toHaveLength(1);
    expect(state.activeBids[0]?.id).toBe('existing-bid-id');
    expect(state.announcement).toContain('Rolled back');
  });
});
