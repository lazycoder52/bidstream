import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders application navigation and branding', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Bid/i })).toBeInTheDocument();
    });
  });
});
