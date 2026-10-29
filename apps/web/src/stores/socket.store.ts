import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  BidDto,
  BidPlacedEvent,
  OutbidNoticeEvent,
  AuctionExtendedEvent,
  AuctionClosedEvent,
  TimeSyncResponse,
} from '@bidstream/contracts';
import { auctionsApi, ApiClientError } from '@/lib/api-client';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface SocketState {
  socket: Socket | null;
  status: ConnectionStatus;
  serverTimeOffset: number; // ms offset between local client clock and server clock
  currentAuctionId: string | null;
  activeBids: BidDto[];
  currentPrice: number;
  bidCount: number;
  endTime: string | null;
  isClosed: boolean;
  winnerId: string | null;
  outbidNotice: OutbidNoticeEvent | null;
  announcement: string | null;

  connect: (token?: string | null) => void;
  disconnect: () => void;
  syncTime: () => Promise<number>;
  getServerNow: () => Date;
  joinAuctionRoom: (
    auctionId: string,
    initialData?: {
      bids: BidDto[];
      price: number;
      bidCount: number;
      endTime: string;
      isClosed: boolean;
      winnerId?: string | null;
    },
  ) => void;
  leaveAuctionRoom: () => void;
  placeOptimisticBid: (
    auctionId: string,
    amount: number,
    currentUser: { id: string; name: string },
  ) => Promise<void>;
  clearOutbidNotice: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
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

  connect: (token) => {
    const existing = get().socket;
    if (existing) {
      if (token) {
        existing.auth = { token };
      }
      return;
    }

    set({ status: 'connecting' });

    const socket: Socket = io({
      transports: ['websocket'],
      auth: token ? { token } : undefined,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      set({ status: 'connected' });
      get().syncTime();

      // If we were already looking at an auction, rejoin with the last bid ID for replay
      const currentAuctionId = get().currentAuctionId;
      if (currentAuctionId) {
        const lastBid = get().activeBids[0];
        socket.emit('auction:join', {
          auctionId: currentAuctionId,
          lastBidId: lastBid?.id,
        });
      }
    });

    socket.on('disconnect', () => {
      set({ status: 'disconnected' });
    });

    socket.on('connect_error', () => {
      set({ status: 'reconnecting' });
    });

    socket.on('bid:placed', (event: BidPlacedEvent) => {
      const state = get();
      if (state.currentAuctionId !== event.auctionId) return;

      // Check if this bid already exists (e.g. from optimistic update)
      const exists = state.activeBids.some(
        (b) =>
          b.id === event.bid.id ||
          (b.amount === event.bid.amount && b.bidderId === event.bid.bidderId),
      );

      const updatedBids = exists
        ? state.activeBids.map((b) =>
            b.amount === event.bid.amount && b.bidderId === event.bid.bidderId ? event.bid : b,
          )
        : [event.bid, ...state.activeBids];

      set({
        activeBids: updatedBids,
        currentPrice: event.currentPrice,
        bidCount: event.bidCount,
        endTime: event.endTime,
        announcement: `New highest bid of $${event.currentPrice} placed by ${event.bid.bidderName || 'a bidder'}.`,
      });
    });

    socket.on('bid:outbid', (event: OutbidNoticeEvent) => {
      set({
        outbidNotice: event,
        announcement: `Alert: You were outbid! The new highest bid is $${event.newPrice}.`,
      });
    });

    socket.on('auction:extended', (event: AuctionExtendedEvent) => {
      const state = get();
      if (state.currentAuctionId !== event.auctionId) return;

      set({
        endTime: event.newEndTime,
        announcement: 'Anti-sniping protection activated! Auction extended by 60 seconds.',
      });
    });

    socket.on('auction:closed', (event: AuctionClosedEvent) => {
      const state = get();
      if (state.currentAuctionId !== event.auctionId) return;

      set({
        isClosed: true,
        winnerId: event.winnerId,
        currentPrice: event.finalPrice,
        announcement: `Auction ended. ${event.winnerName ? `Won by ${event.winnerName}` : 'No winner'}. Final price: $${event.finalPrice}.`,
      });
    });

    socket.on('time:sync:response', (data: TimeSyncResponse) => {
      const clientReceiveTime = Date.now();
      const roundTripTime = clientReceiveTime - data.clientSendTime;
      // Estimated server clock at client receive time = serverSendTime + rtt / 2
      const estimatedServerTime = data.serverSendTime + roundTripTime / 2;
      const offset = estimatedServerTime - clientReceiveTime;
      set({ serverTimeOffset: offset });
    });

    set({ socket });
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
      set({ socket: null, status: 'disconnected' });
    }
  },

  syncTime: async () => {
    const socket = get().socket;
    if (!socket || !socket.connected) return get().serverTimeOffset;

    return new Promise<number>((resolve) => {
      const clientSendTime = Date.now();
      socket.once('time:sync:response', (data: TimeSyncResponse) => {
        const clientReceiveTime = Date.now();
        const rtt = clientReceiveTime - data.clientSendTime;
        const offset = data.serverSendTime + rtt / 2 - clientReceiveTime;
        set({ serverTimeOffset: offset });
        resolve(offset);
      });
      socket.emit('time:sync:request', { clientSendTime });
    });
  },

  getServerNow: () => {
    return new Date(Date.now() + get().serverTimeOffset);
  },

  joinAuctionRoom: (auctionId, initialData) => {
    const socket = get().socket;

    if (initialData) {
      set({
        currentAuctionId: auctionId,
        activeBids: initialData.bids,
        currentPrice: initialData.price,
        bidCount: initialData.bidCount,
        endTime: initialData.endTime,
        isClosed: initialData.isClosed,
        winnerId: initialData.winnerId ?? null,
        outbidNotice: null,
      });
    } else {
      set({
        currentAuctionId: auctionId,
        activeBids: [],
        outbidNotice: null,
      });
    }

    if (socket && socket.connected) {
      const lastBid = initialData?.bids[0];
      socket.emit('auction:join', {
        auctionId,
        lastBidId: lastBid?.id,
      });
    }
  },

  leaveAuctionRoom: () => {
    const { socket, currentAuctionId } = get();
    if (socket && socket.connected && currentAuctionId) {
      socket.emit('auction:leave', { auctionId: currentAuctionId });
    }
    set({
      currentAuctionId: null,
      activeBids: [],
      currentPrice: 0,
      bidCount: 0,
      endTime: null,
      isClosed: false,
      winnerId: null,
      outbidNotice: null,
    });
  },

  placeOptimisticBid: async (auctionId, amount, currentUser) => {
    const previousBids = get().activeBids;
    const previousPrice = get().currentPrice;
    const previousBidCount = get().bidCount;

    // 1. Generate optimistic bid
    const optimisticBid: BidDto = {
      id: `optimistic-${Date.now()}`,
      auctionId,
      bidderId: currentUser.id,
      bidderName: currentUser.name,
      amount,
      createdAt: new Date().toISOString(),
    };

    // 2. Apply optimistic update to UI immediately
    set({
      activeBids: [optimisticBid, ...previousBids],
      currentPrice: amount,
      bidCount: previousBidCount + 1,
      announcement: `Placed bid of $${amount}. Awaiting server confirmation...`,
    });

    const idempotencyKey = `bid-${auctionId}-${currentUser.id}-${Date.now()}`;

    // 3. Dispatch to API
    try {
      const result = await auctionsApi.placeBid(auctionId, { amount }, idempotencyKey);

      // 4. Reconcile on success
      set((state) => ({
        activeBids: state.activeBids.map((b) => (b.id === optimisticBid.id ? result.bid : b)),
        currentPrice: result.currentPrice,
        bidCount: result.bidCount,
        endTime: result.endTime,
        announcement: `Bid of $${amount} successfully accepted! You are now the highest bidder.`,
      }));
    } catch (error) {
      // 5. Rollback on failure (e.g. 409 Conflict, outbid, below increment)
      set({
        activeBids: previousBids,
        currentPrice: previousPrice,
        bidCount: previousBidCount,
        announcement: `Bid placement failed: ${error instanceof ApiClientError ? error.message : 'Outbid or invalid bid amount'}. Rolled back.`,
      });
      throw error;
    }
  },

  clearOutbidNotice: () => set({ outbidNotice: null }),
}));
