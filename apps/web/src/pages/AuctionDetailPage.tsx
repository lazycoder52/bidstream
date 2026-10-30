import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { auctionsApi, ApiClientError } from '@/lib/api-client';
import { useSocketStore } from '@/stores/socket.store';
import { useAuthStore } from '@/stores/auth.store';
import { useWatchlistStore } from '@/stores/watchlist.store';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Gavel,
  Clock,
  User,
  ShieldAlert,
  Bookmark,
  TrendingUp,
  AlertCircle,
  Trophy,
  ArrowLeft,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export const AuctionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const auctionId = id || '';

  const { user, isAuthenticated } = useAuthStore();
  const { isWatched, toggleWatchlist } = useWatchlistStore();
  const watched = isWatched(auctionId);

  const [bidInput, setBidInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  const {
    activeBids,
    currentPrice: livePrice,
    bidCount: liveBidCount,
    endTime: liveEndTime,
    isClosed: liveIsClosed,
    winnerId: liveWinnerId,
    joinAuctionRoom,
    leaveAuctionRoom,
    placeOptimisticBid,
  } = useSocketStore();

  // 1. Initial REST fetch for auction details
  const {
    data: auction,
    isLoading: isAuctionLoading,
    error: auctionError,
  } = useQuery({
    queryKey: ['auction', auctionId],
    queryFn: () => auctionsApi.get(auctionId),
    enabled: !!auctionId,
  });

  // 2. Initial REST fetch for bid history
  const { data: initialBids } = useQuery({
    queryKey: ['auction-bids', auctionId],
    queryFn: () => auctionsApi.getBids(auctionId),
    enabled: !!auctionId,
  });

  // 3. Connect Socket.IO room & sync state on data load
  useEffect(() => {
    if (auction) {
      joinAuctionRoom(auctionId, {
        bids: initialBids || [],
        price: auction.currentPrice,
        bidCount: auction.bidCount,
        endTime: auction.endTime,
        isClosed: auction.status === 'ENDED',
        winnerId: auction.winnerId,
      });
    }

    return () => {
      leaveAuctionRoom();
    };
  }, [auctionId, auction, initialBids]);

  // Real-time server synchronized countdown
  const effectiveEndTime = liveEndTime || auction?.endTime;
  const countdown = useServerCountdown(effectiveEndTime);

  const currentPrice = livePrice || auction?.currentPrice || 0;
  const minIncrement = auction?.minIncrement || 1;
  const minRequiredBid = currentPrice + minIncrement;
  const isAuctionEnded = liveIsClosed || auction?.status === 'ENDED' || countdown.isEnded;

  // Auto-fill bid input with min increment when price changes
  useEffect(() => {
    if (minRequiredBid > 0 && !bidInput) {
      setBidInput(minRequiredBid.toString());
    }
  }, [minRequiredBid]);

  // Virtualized bid list container
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: activeBids.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 5,
  });

  const handlePlaceBid = async (e: React.FormEvent) => {
    e.preventDefault();
    setBidError(null);

    const amount = parseFloat(bidInput);
    if (isNaN(amount) || amount < minRequiredBid) {
      setBidError(
        `Bid must be at least ${formatCurrency(minRequiredBid)} (Current bid + $${minIncrement} minimum increment)`,
      );
      return;
    }

    if (!user) {
      setBidError('Please sign in to place a bid');
      return;
    }

    setIsSubmitting(true);
    try {
      await placeOptimisticBid(auctionId, amount, {
        id: user.id,
        name: user.name,
      });
      // Suggest next increment
      setBidInput((amount + minIncrement).toString());
    } catch (err) {
      if (err instanceof ApiClientError) {
        setBidError(err.message);
      } else {
        setBidError('Failed to place bid. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickIncrement = (additional: number) => {
    const nextAmount = currentPrice + additional;
    setBidInput(nextAmount.toString());
  };

  if (isAuctionLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-10 w-3/4 bg-muted rounded" />
            <div className="h-40 bg-muted rounded-xl" />
          </div>
          <div className="h-96 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (auctionError || !auction) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-12 text-center max-w-lg mx-auto my-12">
        <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
        <h2 className="text-xl font-bold">Auction not found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This auction listing may have been removed or does not exist.
        </p>
        <Link to="/auctions" className="mt-6 inline-block">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to listings
          </Button>
        </Link>
      </div>
    );
  }

  const isSeller = user?.id === auction.sellerId;
  const isWinning =
    user &&
    (isClosed
      ? liveWinnerId === user.id
      : activeBids.length > 0 && activeBids[0]?.bidderId === user.id);

  return (
    <div className="space-y-6">
      {/* Back button and Watchlist */}
      <div className="flex items-center justify-between">
        <Link
          to="/auctions"
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to all auctions
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => toggleWatchlist(auction.id)}
        >
          <Bookmark
            className={`h-4 w-4 ${watched ? 'fill-indigo-600 text-indigo-600 dark:fill-indigo-400 dark:text-indigo-400' : ''}`}
          />
          {watched ? 'Watched' : 'Watch'}
        </Button>
      </div>

      {/* Main Grid: Details (Left) + Bidding Feed & Form (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Product Info & Invariant Metrics */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge
                  variant={
                    !isAuctionEnded ? (countdown.isUrgent ? 'destructive' : 'live') : 'secondary'
                  }
                >
                  {!isAuctionEnded
                    ? countdown.isUrgent
                      ? 'Closing Soon (Anti-Sniping Active)'
                      : 'Live Bidding'
                    : 'Ended'}
                </Badge>
                {auction.reservePrice && (
                  <Badge variant="outline">
                    {currentPrice >= auction.reservePrice ? 'Reserve Met' : 'Reserve Not Met'}
                  </Badge>
                )}
                {isSeller && <Badge variant="secondary">Your Listing</Badge>}
              </div>

              <CardTitle className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {auction.title}
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="prose dark:prose-invert max-w-none text-muted-foreground text-sm leading-relaxed whitespace-pre-line bg-muted/20 p-4 rounded-xl border border-border/50">
                {auction.description}
              </div>

              {/* Specifications & Financial Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-muted/40 border text-xs">
                <div>
                  <span className="text-muted-foreground block">Starting Price</span>
                  <span className="font-semibold text-sm">
                    {formatCurrency(auction.startingPrice)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Minimum Increment</span>
                  <span className="font-semibold text-sm text-indigo-600 dark:text-indigo-400">
                    +{formatCurrency(auction.minIncrement)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Total Placed Bids</span>
                  <span className="font-semibold text-sm">{liveBidCount || auction.bidCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Seller</span>
                  <span className="font-semibold text-sm flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {auction.sellerName || 'Verified Seller'}
                  </span>
                </div>
              </div>

              {/* Anti-sniping protection callout */}
              <div className="flex items-start gap-3 p-3.5 rounded-lg border border-indigo-500/20 bg-indigo-500/5 text-xs text-muted-foreground">
                <ShieldAlert className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-foreground">Anti-Sniping Safeguard:</strong>{' '}
                  Any bid placed within 60 seconds of closing dynamically extends the auction timer
                  by 60 seconds to ensure honest fair-market price discovery.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Live Price, Bidding Console & Virtualized Feed */}
        <div className="space-y-6">
          {/* Live Price & Countdown Console */}
          <Card className="border-2 border-primary/20 shadow-lg">
            <CardHeader className="pb-3 bg-muted/30 border-b">
              <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                Current Highest Bid
              </span>
              <div className="flex items-baseline justify-between gap-2 mt-1">
                <div className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
                  {formatCurrency(currentPrice)}
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1.5 font-bold text-sm">
                    <Clock
                      className={`h-4 w-4 ${countdown.isUrgent ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`}
                    />
                    <span
                      className={
                        countdown.isUrgent ? 'text-red-600 dark:text-red-400 font-extrabold' : ''
                      }
                    >
                      {!isAuctionEnded ? countdown.formatted : 'Closed'}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {!isAuctionEnded ? 'Remaining' : 'Auction Concluded'}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-5">
              {/* Outcome Banner if Ended */}
              {isAuctionEnded ? (
                <div className="rounded-xl border border-border p-4 bg-muted/40 text-center space-y-1">
                  <Trophy className="h-6 w-6 text-amber-500 mx-auto mb-1" />
                  <div className="font-bold text-sm">Auction Finalized</div>
                  <p className="text-xs text-muted-foreground">
                    {liveWinnerId
                      ? isWinning
                        ? 'Congratulations! You won this auction!'
                        : 'A winning bidder has been awarded the listing.'
                      : 'Closed without a winner (reserve not met or no bids).'}
                  </p>
                </div>
              ) : (
                /* Interactive Bid Form */
                <form onSubmit={handlePlaceBid} className="space-y-4">
                  {bidError && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{bidError}</span>
                    </div>
                  )}

                  {isWinning && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                      <Trophy className="h-4 w-4 shrink-0" />
                      <span>You currently hold the highest bid!</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex justify-between">
                      <span>Your Bid Amount</span>
                      <span>Min: {formatCurrency(minRequiredBid)}</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        step="any"
                        disabled={isSubmitting || isSeller || Boolean(isWinning)}
                        className="pl-7 font-bold text-base"
                        value={bidInput}
                        onChange={(e) => setBidInput(e.target.value)}
                        placeholder={minRequiredBid.toString()}
                      />
                    </div>
                  </div>

                  {/* Quick-increment shortcuts */}
                  {!isSeller && !isWinning && (
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleQuickIncrement(minIncrement)}
                      >
                        +{formatCurrency(minIncrement)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleQuickIncrement(10)}
                      >
                        +$10
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => handleQuickIncrement(50)}
                      >
                        +$50
                      </Button>
                    </div>
                  )}

                  {/* Action button */}
                  {!isAuthenticated ? (
                    <Link to="/login" className="block">
                      <Button type="button" className="w-full" variant="default">
                        Sign in to Bid
                      </Button>
                    </Link>
                  ) : isSeller ? (
                    <Button type="button" disabled className="w-full">
                      Sellers Cannot Bid on Own Item
                    </Button>
                  ) : isWinning ? (
                    <Button type="button" disabled variant="secondary" className="w-full font-bold">
                      Highest Bidder
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full font-bold shadow-md gap-2"
                      size="lg"
                    >
                      <Gavel className="h-4 w-4" />
                      {isSubmitting
                        ? 'Placing Bid...'
                        : `Bid ${bidInput ? formatCurrency(parseFloat(bidInput) || 0) : ''}`}
                    </Button>
                  )}
                </form>
              )}
            </CardContent>
          </Card>

          {/* Virtualized Real-time Bid History Feed */}
          <Card>
            <CardHeader className="p-4 pb-2 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                Live Bidding Feed
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {activeBids.length} records
              </Badge>
            </CardHeader>

            <CardContent className="p-0">
              {activeBids.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No bids have been placed yet. Be the first to bid!
                </div>
              ) : (
                <div
                  ref={parentRef}
                  className="h-80 overflow-y-auto px-4 divide-y divide-border/50"
                  tabIndex={0}
                  aria-label="Live bid history feed"
                >
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const bid = activeBids[virtualRow.index];
                      if (!bid) return null;
                      const isTopBid = virtualRow.index === 0;

                      return (
                        <div
                          key={bid.id}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                          className={`flex items-center justify-between py-2 text-xs transition-colors ${
                            isTopBid ? 'bg-indigo-500/10 font-bold px-2 rounded-md' : ''
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {bid.bidderName || 'Bidder'}
                              {bid.bidderId === user?.id ? ' (You)' : ''}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(bid.createdAt).toLocaleTimeString()}
                            </span>
                          </div>

                          <div className="text-right">
                            <span
                              className={`text-sm ${isTopBid ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' : 'font-semibold'}`}
                            >
                              {formatCurrency(bid.amount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
