import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Mock standard active auction returning AuctionDto directly
  http.get('*/api/auctions/test-auction-uuid', () => {
    return HttpResponse.json({
      id: '11111111-2222-3333-4444-555555555555',
      title: 'MSW Test Watch',
      description: 'Mocked auction item',
      startingPrice: 100,
      currentPrice: 100,
      minIncrement: 10,
      status: 'ACTIVE',
      startTime: new Date(Date.now() - 60000).toISOString(),
      endTime: new Date(Date.now() + 300000).toISOString(),
      sellerId: '11111111-0000-0000-0000-000000000000',
      winnerId: null,
      bidCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),

  // Mock contract validation violation (missing required fields, negative startingPrice)
  http.get('*/api/auctions/malformed-schema', () => {
    return HttpResponse.json({
      id: 'not-a-valid-uuid',
      title: 'Broken Contract',
      startingPrice: -100,
    });
  }),

  // Mock successful bid placement
  http.post('*/api/auctions/test-auction-uuid/bids', async ({ request }) => {
    const body = (await request.json()) as { amount: number };
    return HttpResponse.json(
      {
        bid: {
          id: 'bid-uuid-msw',
          auctionId: '11111111-2222-3333-4444-555555555555',
          bidderId: 'buyer-uuid',
          bidderName: 'MSW Bidder',
          amount: body.amount,
          createdAt: new Date().toISOString(),
        },
        currentPrice: body.amount,
        bidCount: 1,
        endTime: new Date(Date.now() + 300000).toISOString(),
        extended: false,
      },
      { status: 201 },
    );
  }),

  // Mock 409 Conflict bid placement (outbid by competitor)
  http.post('*/api/auctions/conflict-auction/bids', () => {
    return HttpResponse.json(
      {
        success: false,
        statusCode: 409,
        message: 'Bid amount is below the current required minimum increment',
        timestamp: new Date().toISOString(),
      },
      { status: 409 },
    );
  }),
];

export const server = setupServer(...handlers);
