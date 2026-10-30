import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { RouteErrorBoundary } from './components/ErrorBoundary';

const AuctionsListPage = lazy(() =>
  import('./pages/AuctionsListPage').then((m) => ({
    default: m.AuctionsListPage,
  })),
);

const AuctionDetailPage = lazy(() =>
  import('./pages/AuctionDetailPage').then((m) => ({
    default: m.AuctionDetailPage,
  })),
);

const CreateAuctionPage = lazy(() =>
  import('./pages/CreateAuctionPage').then((m) => ({
    default: m.CreateAuctionPage,
  })),
);

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));

const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);

const SellerDashboardPage = lazy(() =>
  import('./pages/SellerDashboardPage').then((m) => ({
    default: m.SellerDashboardPage,
  })),
);

const PageLoader: React.FC = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
  </div>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <Navigate to="/auctions" replace />,
      },
      {
        path: 'auctions',
        element: (
          <Suspense fallback={<PageLoader />}>
            <AuctionsListPage />
          </Suspense>
        ),
      },
      {
        path: 'auctions/:id',
        element: (
          <Suspense fallback={<PageLoader />}>
            <AuctionDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'auctions/create',
        element: (
          <Suspense fallback={<PageLoader />}>
            <CreateAuctionPage />
          </Suspense>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SellerDashboardPage />
          </Suspense>
        ),
      },
      {
        path: 'login',
        element: (
          <Suspense fallback={<PageLoader />}>
            <LoginPage />
          </Suspense>
        ),
      },
      {
        path: 'register',
        element: (
          <Suspense fallback={<PageLoader />}>
            <RegisterPage />
          </Suspense>
        ),
      },
      {
        path: '*',
        element: <Navigate to="/auctions" replace />,
      },
    ],
  },
]);
