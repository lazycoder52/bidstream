import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Gavel, Sun, Moon, Bookmark, PlusCircle, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useThemeStore } from '@/stores/theme.store';
import { useWatchlistStore } from '@/stores/watchlist.store';
import { useSocketStore } from '@/stores/socket.store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const Navbar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const { watchedIds } = useWatchlistStore();
  const socketStatus = useSocketStore((state) => state.status);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Gavel className="h-5 w-5" />
            </div>
            <span>
              Bid<span className="text-indigo-600 dark:text-indigo-400">Stream</span>
            </span>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-5 text-sm font-medium">
            <Link
              to="/auctions"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Auctions
            </Link>
            {user?.role === 'SELLER' || user?.role === 'ADMIN' ? (
              <>
                <Link
                  to="/auctions/create"
                  className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                >
                  <PlusCircle className="h-4 w-4" />
                  Create Auction
                </Link>
                <Link
                  to="/dashboard"
                  className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  Seller Dashboard
                </Link>
              </>
            ) : null}
          </nav>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Socket status indicator */}
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={`Realtime Gateway: ${socketStatus}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                socketStatus === 'connected'
                  ? 'bg-emerald-500'
                  : socketStatus === 'reconnecting'
                    ? 'bg-amber-500 animate-ping'
                    : 'bg-muted-foreground'
              }`}
            />
            <span className="hidden sm:inline capitalize">{socketStatus}</span>
          </div>

          {/* Watchlist counter */}
          <Link to="/auctions?watchlist=true">
            <Button variant="ghost" size="icon" className="relative" title="Watchlist">
              <Bookmark className="h-4 w-4" />
              {watchedIds.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                  {watchedIds.length}
                </span>
              )}
            </Button>
          </Link>

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </Button>

          {/* User auth state */}
          {isAuthenticated && user ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-medium leading-none">{user.name}</span>
                <span className="text-[10px] text-muted-foreground capitalize">
                  {user.role.toLowerCase()}
                </span>
              </div>
              <Badge variant="outline" className="hidden lg:inline-flex">
                {user.role}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="gap-1.5"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link to="/register">
                <Button size="sm">Register</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
