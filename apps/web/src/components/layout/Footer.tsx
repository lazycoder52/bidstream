import React from 'react';
import { ShieldCheck, Zap, Activity } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t bg-muted/30 py-8 text-sm text-muted-foreground mt-auto">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">BidStream</span>
            <span>&copy; {new Date().getFullYear()}</span>
            <span>&bull; High-Concurrency Real-Time Auction Engine</span>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Pessimistic Row Locks (FOR UPDATE)
            </span>
            <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
              <Zap className="h-3.5 w-3.5" />
              Socket.IO + Redis Pub/Sub
            </span>
            <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
              <Activity className="h-3.5 w-3.5" />
              Single Source of Truth Contracts
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
