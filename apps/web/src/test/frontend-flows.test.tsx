import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { server } from './msw-server';
import { auctionsApi, ApiClientError } from '../lib/api-client';
import { useSocketStore } from '../stores/socket.store';
import { useServerCountdown } from '../hooks/useServerCountdown';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  useSocketStore.getState().leaveAuctionRoom();
  useSocketStore.setState({ serverTimeOffset: 0, announcement: null });
});
afterAll(() => server.close());

describe('Frontend Integration Flows (MSW + Testing Library)', () => {
  describe('Contracts Runtime Validation under MSW', () => {
    it('successfully fetches and validates contract schema on valid endpoint', async () => {
      const auction = await auctionsApi.get('test-auction-uuid');
      expect(auction.id).toBe('11111111-2222-3333-4444-555555555555');
      expect(auction.title).toBe('MSW Test Watch');
      expect(auction.currentPrice).toBe(100);
      expect(auction.status).toBe('ACTIVE');
    });

    it('rejects when backend response violates shared contract schema', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(auctionsApi.get('malformed-schema')).rejects.toThrow(
        /API response validation failed/,
      );
    });
  });

  describe('Countdown Clock Drift Compensation', () => {
    it('accurately compensates for client-server clock drift in countdown calculations', () => {
      const now = Date.now();
      const targetEndTime = new Date(now + 60000).toISOString(); // 60s in future

      // Client clock is 5000ms behind server (server is ahead)
      useSocketStore.setState({ serverTimeOffset: 5000 });

      const { result } = renderHook(() => useServerCountdown(targetEndTime));

      // Effective current server time = now + 5000ms
      // Expected remaining = 60000 - 5000 = ~55000ms
      expect(result.current.remainingMs).toBeLessThanOrEqual(55100);
      expect(result.current.remainingMs).toBeGreaterThanOrEqual(54000);
      expect(result.current.isEnded).toBe(false);
    });

    it('reports isEnded=true when drifted server time exceeds auction end_time', () => {
      const now = Date.now();
      const targetEndTime = new Date(now + 2000).toISOString(); // 2s in future on client

      // Server is 5000ms ahead -> already expired on server!
      useSocketStore.setState({ serverTimeOffset: 5000 });

      const { result } = renderHook(() => useServerCountdown(targetEndTime));

      expect(result.current.isEnded).toBe(true);
      expect(result.current.remainingMs).toBe(0);
    });
  });

  describe('Optimistic Bidding with HTTP 409 Rollback', () => {
    it('applies optimistic bid immediately and rolls back state when server responds with 409 Conflict', async () => {
      const store = useSocketStore.getState();

      // Initialize state for an auction
      store.joinAuctionRoom('conflict-auction', {
        bids: [],
        price: 200,
        bidCount: 3,
        endTime: new Date(Date.now() + 300000).toISOString(),
        isClosed: false,
      });

      expect(useSocketStore.getState().currentPrice).toBe(200);

      // Attempt optimistic bid against MSW endpoint configured to return 409
      let caughtError: unknown = null;
      await act(async () => {
        try {
          await store.placeOptimisticBid('conflict-auction', 250, {
            id: 'my-user-id',
            name: 'My Name',
          });
        } catch (err) {
          caughtError = err;
        }
      });

      // Verify that error was caught and was ApiClientError with status 409
      expect(caughtError).toBeInstanceOf(ApiClientError);
      expect((caughtError as ApiClientError).statusCode).toBe(409);

      // Verify rollback: price reverted to 200, optimistic bid removed
      const finalState = useSocketStore.getState();
      expect(finalState.currentPrice).toBe(200);
      expect(finalState.activeBids.some((b) => b.amount === 250)).toBe(false);

      // Screen-reader aria-live announcement was recorded
      expect(finalState.announcement).toMatch(/Bid placement failed/i);
    });
  });
});
