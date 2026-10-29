import React from 'react';
import { Link } from 'react-router-dom';
import { AuctionDto } from '@bidstream/contracts';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bookmark, Clock, User } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { useWatchlistStore } from '@/stores/watchlist.store';

interface AuctionCardProps {
  auction: AuctionDto;
}

export const AuctionCard: React.FC<AuctionCardProps> = ({ auction }) => {
  const { isWatched, toggleWatchlist } = useWatchlistStore();
  const watched = isWatched(auction.id);
  const countdown = useServerCountdown(auction.endTime);

  const isLive = auction.status === 'ACTIVE' && !countdown.isEnded;

  return (
    <Card className="flex flex-col h-full overflow-hidden hover:shadow-md transition-shadow group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant={isLive ? (countdown.isUrgent ? 'destructive' : 'live') : 'secondary'}>
            {isLive ? (countdown.isUrgent ? 'Closing Soon' : 'Live') : 'Ended'}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
            onClick={(e) => {
              e.preventDefault();
              toggleWatchlist(auction.id);
            }}
            title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Bookmark
              className={`h-4 w-4 ${watched ? 'fill-indigo-600 text-indigo-600 dark:fill-indigo-400 dark:text-indigo-400' : ''}`}
            />
          </Button>
        </div>
        <CardTitle className="line-clamp-2 mt-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
          <Link to={`/auctions/${auction.id}`}>{auction.title}</Link>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 pb-4">
        <p className="text-xs text-muted-foreground line-clamp-2 mb-4">{auction.description}</p>

        <div className="grid grid-cols-2 gap-2 bg-muted/40 p-3 rounded-lg text-xs">
          <div>
            <span className="text-muted-foreground block">Current Bid</span>
            <span className="font-bold text-base text-foreground">
              {formatCurrency(auction.currentPrice)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground block">Bids</span>
            <span className="font-semibold text-sm text-foreground">
              {auction.bidCount} {auction.bidCount === 1 ? 'bid' : 'bids'}
            </span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="pt-0 flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 p-4 mt-auto">
        <div className="flex items-center gap-1.5 font-medium">
          <Clock
            className={`h-3.5 w-3.5 ${countdown.isUrgent ? 'text-red-500 animate-pulse' : ''}`}
          />
          <span className={countdown.isUrgent ? 'text-red-600 dark:text-red-400 font-bold' : ''}>
            {isLive ? countdown.formatted : 'Auction Ended'}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          <User className="h-3 w-3" />
          <span>{auction.sellerName || 'Seller'}</span>
        </div>
      </CardFooter>
    </Card>
  );
};
