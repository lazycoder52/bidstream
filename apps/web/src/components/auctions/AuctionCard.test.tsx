import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuctionCard } from './AuctionCard';
import { AuctionDto } from '@bidstream/contracts';

describe('AuctionCard Component', () => {
  const mockAuction: AuctionDto = {
    id: '11111111-2222-3333-4444-555555555555',
    title: 'Vintage Chronograph Watch',
    description: 'Rare collectible wristwatch in mint condition.',
    startingPrice: 100,
    currentPrice: 250,
    minIncrement: 10,
    status: 'ACTIVE',
    sellerId: '99999999-8888-7777-6666-555555555555',
    sellerName: 'Watch Collector',
    bidCount: 8,
    startTime: new Date(Date.now() - 3600000).toISOString(),
    endTime: new Date(Date.now() + 7200000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('renders auction details, price, and live status correctly', () => {
    render(
      <BrowserRouter>
        <AuctionCard auction={mockAuction} />
      </BrowserRouter>,
    );

    expect(screen.getByText('Vintage Chronograph Watch')).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
    expect(screen.getByText('8 bids')).toBeInTheDocument();
    expect(screen.getByText('Watch Collector')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });
});
