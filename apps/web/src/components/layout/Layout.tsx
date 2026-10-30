import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { useAuthStore } from '@/stores/auth.store';
import { useSocketStore } from '@/stores/socket.store';
import { AlertCircle, WifiOff, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const Layout: React.FC = () => {
  const { checkAuth, accessToken } = useAuthStore();
  const {
    connect,
    status: socketStatus,
    outbidNotice,
    clearOutbidNotice,
    announcement,
  } = useSocketStore();

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    connect(accessToken);
  }, [accessToken]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground transition-colors selection:bg-indigo-500 selection:text-white">
      {/* Screen-reader accessible live announcement region */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-announcer">
        {announcement}
      </div>

      {/* Gateway reconnecting warning banner */}
      {socketStatus === 'reconnecting' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs font-medium flex items-center justify-center gap-2">
          <WifiOff className="h-4 w-4 animate-pulse text-amber-600 dark:text-amber-400" />
          <span>Real-time connection lost. Attempting automatic reconnection...</span>
        </div>
      )}

      {/* Global Outbid Notification Banner */}
      {outbidNotice && (
        <div className="bg-red-500/15 border-b border-red-500/30 text-red-900 dark:text-red-200 px-4 py-2.5 text-sm font-medium flex items-center justify-between shadow-sm">
          <div className="container mx-auto flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>
              You were outbid! The new highest bid is{' '}
              <strong className="font-bold underline">
                {formatCurrency(outbidNotice.newPrice)}
              </strong>
              .
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearOutbidNotice}
            className="h-6 w-6 p-0 hover:bg-red-500/20"
            title="Dismiss notice"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 py-6 md:py-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <Footer />
    </div>
  );
};
