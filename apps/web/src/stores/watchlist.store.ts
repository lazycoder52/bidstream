import { create } from 'zustand';

interface WatchlistState {
  watchedIds: string[];
  toggleWatchlist: (auctionId: string) => void;
  isWatched: (auctionId: string) => boolean;
}

const STORAGE_KEY = 'bidstream_watchlist';

const getInitialWatchlist = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  watchedIds: getInitialWatchlist(),

  toggleWatchlist: (auctionId) => {
    const current = get().watchedIds;
    const exists = current.includes(auctionId);
    const updated = exists ? current.filter((id) => id !== auctionId) : [...current, auctionId];

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Storage full or unavailable
    }

    set({ watchedIds: updated });
  },

  isWatched: (auctionId) => get().watchedIds.includes(auctionId),
}));
