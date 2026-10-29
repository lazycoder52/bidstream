import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { auctionsApi } from '@/lib/api-client';
import { AuctionCard } from '@/components/auctions/AuctionCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWatchlistStore } from '@/stores/watchlist.store';
import { useAuthStore } from '@/stores/auth.store';
import { Search, PlusCircle, Gavel, RefreshCw, Bookmark } from 'lucide-react';
import { AuctionStatus } from '@bidstream/contracts';

export const AuctionsListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const statusParam = (searchParams.get('status') as AuctionStatus) || undefined;
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const watchlistParam = searchParams.get('watchlist') === 'true';

  const { watchedIds } = useWatchlistStore();
  const { user } = useAuthStore();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['auctions', { status: statusParam, search: searchTerm, page: pageParam }],
    queryFn: () =>
      auctionsApi.list({
        status: statusParam,
        search: searchTerm || undefined,
        page: pageParam,
        limit: 12,
      }),
    staleTime: 10000,
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (searchTerm.trim()) {
      next.set('search', searchTerm.trim());
    } else {
      next.delete('search');
    }
    next.set('page', '1');
    setSearchParams(next);
  };

  const handleStatusFilter = (status?: AuctionStatus) => {
    const next = new URLSearchParams(searchParams);
    if (status) {
      next.set('status', status);
    } else {
      next.delete('status');
    }
    next.set('page', '1');
    setSearchParams(next);
  };

  const handlePageChange = (newPage: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', newPage.toString());
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filter for watchlist if toggle enabled
  const displayedAuctions = data?.items
    ? watchlistParam
      ? data.items.filter((a) => watchedIds.includes(a.id))
      : data.items
    : [];

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Live Auctions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse real-time listings protected by serialized row-level pessimistic locking.
          </p>
        </div>

        {user?.role === 'SELLER' || user?.role === 'ADMIN' ? (
          <Link to="/auctions/create">
            <Button className="gap-2 shadow-sm">
              <PlusCircle className="h-4 w-4" />
              Create Auction
            </Button>
          </Link>
        ) : null}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-96">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search auctions by title..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Button
            variant={!statusParam && !watchlistParam ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('watchlist');
              next.delete('status');
              next.set('page', '1');
              setSearchParams(next);
            }}
          >
            All
          </Button>
          <Button
            variant={statusParam === 'ACTIVE' && !watchlistParam ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('watchlist');
              handleStatusFilter('ACTIVE');
            }}
          >
            Active Only
          </Button>
          <Button
            variant={statusParam === 'ENDED' && !watchlistParam ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('watchlist');
              handleStatusFilter('ENDED');
            }}
          >
            Ended
          </Button>

          <Button
            variant={watchlistParam ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (watchlistParam) {
                next.delete('watchlist');
              } else {
                next.set('watchlist', 'true');
              }
              next.set('page', '1');
              setSearchParams(next);
            }}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Watchlist ({watchedIds.length})
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh listings"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-72 rounded-xl border bg-card animate-pulse p-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="h-5 w-20 bg-muted rounded" />
                <div className="h-6 w-3/4 bg-muted rounded" />
                <div className="h-10 w-full bg-muted rounded" />
              </div>
              <div className="h-12 w-full bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-8 text-center">
          <p className="text-destructive font-semibold">Failed to load auctions</p>
          <p className="text-muted-foreground text-sm mt-1">
            {error instanceof Error ? error.message : 'Please check your connection'}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-4">
            Try Again
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && displayedAuctions.length === 0 && (
        <div className="rounded-2xl border border-dashed p-12 text-center bg-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto mb-4">
            <Gavel className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">No auctions found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-1">
            {watchlistParam
              ? 'You have not added any auctions to your watchlist yet. Click the bookmark icon on any auction.'
              : 'There are no auctions matching your current filter criteria.'}
          </p>
        </div>
      )}

      {/* Grid of Auctions */}
      {!isLoading && !isError && displayedAuctions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {displayedAuctions.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(data.page - 1)}
            disabled={!data.hasPrevPage}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground px-3">
            Page {data.page} of {data.totalPages} ({data.total} total)
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(data.page + 1)}
            disabled={!data.hasNextPage}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};
