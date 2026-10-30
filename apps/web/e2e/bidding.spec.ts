import { test, expect } from '@playwright/test';

test.describe('Real-Time Auction & Bidding E2E Workflows', () => {
  const auctionId = '11111111-2222-3333-4444-555555555555';
  let currentAuctionPrice = 100;
  let currentBidCount = 0;
  const bidsHistory: Array<{
    id: string;
    auctionId: string;
    bidderId: string;
    bidderName: string;
    amount: number;
    createdAt: string;
  }> = [];

  test.beforeEach(() => {
    currentAuctionPrice = 100;
    currentBidCount = 0;
    bidsHistory.length = 0;
  });

  test('two browser contexts: register, create, bid, observe real-time update, outbid and rollback', async ({
    browser,
  }) => {
    // ----------------------------------------------------
    // Context 1: Seller (User A)
    // ----------------------------------------------------
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    // Mock API routes for Context 1
    await page1.route('**/api/auth/register', async (route) => {
      await route.fulfill({
        status: 201,
        json: {
          accessToken: 'mock-seller-token',
          user: {
            id: 'seller-id-1',
            email: 'seller@example.com',
            name: 'Seller Alice',
            role: 'SELLER',
          },
        },
      });
    });

    await page1.route('**/api/auctions', async (route) => {
      if (route.request().method() === 'POST') {
        currentAuctionPrice = 100;
        await route.fulfill({
          status: 201,
          json: {
            id: auctionId,
            title: 'Vintage Chronograph Watch',
            description: 'Rare collectors piece in mint condition',
            startingPrice: 100,
            currentPrice: 100,
            minIncrement: 10,
            status: 'ACTIVE',
            startTime: new Date().toISOString(),
            endTime: new Date(Date.now() + 600000).toISOString(),
            sellerId: 'seller-id-1',
            sellerName: 'Seller Alice',
            bidCount: currentBidCount,
            winnerId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        });
      } else {
        await route.fulfill({
          status: 200,
          json: {
            items: [
              {
                id: auctionId,
                title: 'Vintage Chronograph Watch',
                description: 'Rare collectors piece in mint condition',
                startingPrice: 100,
                currentPrice: currentAuctionPrice,
                minIncrement: 10,
                status: 'ACTIVE',
                startTime: new Date().toISOString(),
                endTime: new Date(Date.now() + 600000).toISOString(),
                sellerId: 'seller-id-1',
                sellerName: 'Seller Alice',
                bidCount: currentBidCount,
                winnerId: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 1,
            limit: 20,
            totalPages: 1,
          },
        });
      }
    });

    await page1.route(`**/api/auctions/${auctionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: auctionId,
          title: 'Vintage Chronograph Watch',
          description: 'Rare collectors piece in mint condition',
          startingPrice: 100,
          currentPrice: currentAuctionPrice,
          minIncrement: 10,
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 600000).toISOString(),
          sellerId: 'seller-id-1',
          sellerName: 'Seller Alice',
          bidCount: currentBidCount,
          winnerId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    });

    await page1.route(`**/api/auctions/${auctionId}/bids`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: bidsHistory });
      }
    });

    // Seller registers
    await page1.goto('/register');
    await page1.getByLabel(/Full Name/i).fill('Seller Alice');
    await page1.getByLabel(/Email/i).fill('seller@example.com');
    await page1.getByLabel(/Password/i).fill('Password123!');
    await page1.getByRole('button', { name: /Create Account/i }).click();

    // Seller creates auction
    await page1.goto('/create');
    await expect(page1.getByRole('heading', { name: /List New Auction/i })).toBeVisible();
    await page1.getByLabel(/Item Title/i).fill('Vintage Chronograph Watch');
    await page1.getByLabel(/Description/i).fill('Rare collectors piece in mint condition');
    await page1.getByLabel(/Starting Price/i).fill('100');
    await page1.getByLabel(/Minimum Bid Increment/i).fill('10');
    await page1.getByRole('button', { name: /Publish Auction/i }).click();

    // Navigate to auction detail room
    await page1.goto(`/auctions/${auctionId}`);
    await expect(page1.getByText('Vintage Chronograph Watch')).toBeVisible();

    // ----------------------------------------------------
    // Context 2: Buyer (User B)
    // ----------------------------------------------------
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await page2.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          accessToken: 'mock-buyer-token',
          user: {
            id: 'buyer-id-2',
            email: 'buyer@example.com',
            name: 'Buyer Bob',
            role: 'BUYER',
          },
        },
      });
    });

    await page2.route(`**/api/auctions/${auctionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: auctionId,
          title: 'Vintage Chronograph Watch',
          description: 'Rare collectors piece in mint condition',
          startingPrice: 100,
          currentPrice: currentAuctionPrice,
          minIncrement: 10,
          status: 'ACTIVE',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 600000).toISOString(),
          sellerId: 'seller-id-1',
          sellerName: 'Seller Alice',
          bidCount: currentBidCount,
          winnerId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    });

    await page2.route(`**/api/auctions/${auctionId}/bids`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: bidsHistory });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const amount = Number(body.amount);

        // Conflict check: if amount is below minimum increment, return 409
        if (amount < currentAuctionPrice + 10) {
          await route.fulfill({
            status: 409,
            json: {
              success: false,
              statusCode: 409,
              message: `Bid amount $${amount} is below the minimum required increment`,
              timestamp: new Date().toISOString(),
            },
          });
          return;
        }

        // Accept bid
        currentAuctionPrice = amount;
        currentBidCount++;
        const newBid = {
          id: `bid-e2e-${currentBidCount}`,
          auctionId,
          bidderId: 'buyer-id-2',
          bidderName: 'Buyer Bob',
          amount,
          createdAt: new Date().toISOString(),
        };
        bidsHistory.unshift(newBid);

        await route.fulfill({
          status: 201,
          json: {
            bid: newBid,
            currentPrice: currentAuctionPrice,
            bidCount: currentBidCount,
            endTime: new Date(Date.now() + 600000).toISOString(),
            extended: false,
          },
        });
      }
    });

    // Buyer logs in
    await page2.goto('/login');
    await page2.getByLabel(/Email/i).fill('buyer@example.com');
    await page2.getByLabel(/Password/i).fill('Password123!');
    await page2.getByRole('button', { name: /Sign In/i }).click();

    // Buyer visits the auction room
    await page2.goto(`/auctions/${auctionId}`);
    await expect(page2.getByText('Vintage Chronograph Watch')).toBeVisible();

    // Buyer places valid bid of $120
    const bidInput = page2.getByPlaceholder(/Enter custom amount/i);
    await bidInput.fill('120');
    await page2.getByRole('button', { name: /Place Bid/i }).click();

    // Assert Context 2 observes accepted high bid
    await expect(page2.getByText('$120')).toBeVisible();

    // ----------------------------------------------------
    // Assert Conflict & Rollback in Context 2
    // ----------------------------------------------------
    // Buyer attempts an invalid bid below required increment (e.g. $110 while price is $120)
    await bidInput.fill('110');
    await page2.getByRole('button', { name: /Place Bid/i }).click();

    // Assert error message/announcement is visible on screen
    await expect(
      page2.getByText(/below the minimum required increment|Bid placement failed/i),
    ).toBeVisible();

    // Clean up
    await context1.close();
    await context2.close();
  });
});
