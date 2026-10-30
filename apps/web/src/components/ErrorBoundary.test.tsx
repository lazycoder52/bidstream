import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';

// Helper component that throws an error when trigger is set
const ProblemChild: React.FC<{ shouldThrow: boolean; message?: string }> = ({
  shouldThrow,
  message = 'Simulated crash in ProblemChild',
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>ProblemChild rendered normally</div>;
};

describe('ErrorBoundary', () => {
  let originalError: typeof console.error;

  beforeEach(() => {
    originalError = console.error;
    // Suppress React's error boundary console logs in tests
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when no error occurs', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('catches render error in a child and renders the default fallback UI', () => {
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <ProblemChild shouldThrow={true} message="Critical render failure" />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    // Fallback UI should be rendered with role="alert"
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Critical render failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Home/i })).toBeInTheDocument();
  });

  it('renders custom function fallback with error details and reset capability', () => {
    const TestComponent = () => {
      const [hasError, setHasError] = useState(true);

      return (
        <MemoryRouter>
          <ErrorBoundary
            fallback={({ error, resetErrorBoundary }) => (
              <div>
                <h2>Custom Error Screen</h2>
                <p>{error.message}</p>
                <button
                  onClick={() => {
                    setHasError(false);
                    resetErrorBoundary();
                  }}
                >
                  Custom Reset Button
                </button>
              </div>
            )}
          >
            <ProblemChild shouldThrow={hasError} message="Custom fallback failure" />
          </ErrorBoundary>
        </MemoryRouter>
      );
    };

    render(<TestComponent />);

    expect(screen.getByText('Custom Error Screen')).toBeInTheDocument();
    expect(screen.getByText('Custom fallback failure')).toBeInTheDocument();

    // Click reset button
    fireEvent.click(screen.getByRole('button', { name: 'Custom Reset Button' }));

    // Should now render the child normally
    expect(screen.getByText('ProblemChild rendered normally')).toBeInTheDocument();
  });

  it('triggers onError callback when an error is caught', () => {
    const onErrorMock = vi.fn();

    render(
      <MemoryRouter>
        <ErrorBoundary onError={onErrorMock}>
          <ProblemChild shouldThrow={true} message="Logged error" />
        </ErrorBoundary>
      </MemoryRouter>,
    );

    expect(onErrorMock).toHaveBeenCalledTimes(1);
    expect(onErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Logged error' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });
});
