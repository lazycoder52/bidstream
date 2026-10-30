import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './ui/button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; resetErrorBoundary: () => void }) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          resetErrorBoundary: this.resetErrorBoundary,
        });
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-[300px] flex flex-col items-center justify-center p-8 text-center bg-card border border-destructive/20 rounded-xl my-6 shadow-sm mx-auto max-w-lg"
        >
          <div className="h-12 w-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md break-words">
            {this.state.error.message || 'An unexpected application error occurred.'}
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={this.resetErrorBoundary}
              variant="default"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link to="/" className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                Go to Home
              </Link>
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Route-level error boundary component for React Router errorElement.
 */
export const RouteErrorBoundary: React.FC = () => {
  const error = useRouteError();

  let title = 'Something went wrong';
  let message = 'An unexpected routing error occurred.';

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = error.data?.message || error.statusText || message;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center"
    >
      <div className="h-16 w-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-6">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground mb-3">{title}</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-md break-words">{message}</p>
      <div className="flex items-center gap-4">
        <Button
          onClick={() => window.location.reload()}
          variant="default"
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Reload Page
        </Button>
        <Button asChild variant="outline">
          <Link to="/" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            Go to Home
          </Link>
        </Button>
      </div>
    </div>
  );
};
