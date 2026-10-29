import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { auctionsApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import {
  PlusCircle,
  LayoutDashboard,
  Package,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react';

export const SellerDashboardPage: React.FC = () => {
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: ['seller-auctions', user?.id],
    queryFn: () => auctionsApi.list({ sellerId: user?.id, limit: 100 }),
    enabled: !!user?.id,
  });

  const auctions = data?.items || [];
  const activeAuctions = auctions.filter((a) => a.status === 'ACTIVE');
  const closedAuctions = auctions.filter((a) => a.status === 'ENDED');
  const totalVolume = closedAuctions.reduce((sum, a) => sum + (a.winnerId ? a.currentPrice : 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
            Seller Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your inventory, monitor active bidding activity, and track performance.
          </p>
        </div>

        <Link to="/auctions/create">
          <Button className="gap-2 shadow-sm">
            <PlusCircle className="h-4 w-4" />
            Create New Auction
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Total Listings
              </span>
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-black mt-2">{auctions.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Active Listings
              </span>
              <Clock className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-black mt-2 text-emerald-600 dark:text-emerald-400">
              {activeAuctions.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Completed Sales
              </span>
              <CheckCircle2 className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-black mt-2">{closedAuctions.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Gross Volume Awarded
              </span>
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">$USD</span>
            </div>
            <div className="text-2xl font-black mt-2 text-indigo-600 dark:text-indigo-400">
              {formatCurrency(totalVolume)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Listings Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Listings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2 py-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : auctions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              You have not created any listings yet.{' '}
              <Link to="/auctions/create" className="text-indigo-600 font-semibold hover:underline">
                Create your first listing
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/30 text-muted-foreground uppercase font-semibold">
                  <tr>
                    <th className="p-3">Title</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Current Bid</th>
                    <th className="p-3">Bids</th>
                    <th className="p-3">End Time</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {auctions.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-semibold max-w-xs truncate">
                        <Link to={`/auctions/${item.id}`} className="hover:underline">
                          {item.title}
                        </Link>
                      </td>
                      <td className="p-3">
                        <Badge variant={item.status === 'ACTIVE' ? 'live' : 'secondary'}>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="p-3 font-bold">{formatCurrency(item.currentPrice)}</td>
                      <td className="p-3">{item.bidCount}</td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(item.endTime).toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <Link to={`/auctions/${item.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                            View <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
