import { test, expect } from '@playwright/test';

test.describe('Real-Time Auction & Bidding E2E Workflows', () => {
  test('Flow 1: register, create, bid, live update in a second context', async ({
    browser,
    baseURL,
  }) => {
    const targetUrl = baseURL || 'http://localhost:8080';

    // ----------------------------------------------------
    // Context 1: Seller (User A)
    // ----------------------------------------------------
    const sellerContext = await browser.newContext();
    const sellerPage = await sellerContext.newPage();
    const timestamp = Date.now();
    const sellerEmail = `seller-${timestamp}@example.com`;

    // 1. Seller registers
    await sellerPage.goto(`${targetUrl}/register`);
    await sellerPage.locator('#name').fill('Seller Alice');
    await sellerPage.locator('#email').fill(sellerEmail);
    await sellerPage.locator('#password').fill('Password123!');
    await sellerPage.locator('#role').selectOption('SELLER');
    await sellerPage.getByRole('button', { name: /Create Account/i }).click();

    // Verify successful registration and navigation to /auctions
    await sellerPage.waitForURL(/\/auctions$/);

    // 2. Seller navigates to create auction listing via navbar
    await sellerPage
      .getByRole('navigation')
      .getByRole('link', { name: /Create Auction/i })
      .click();
    await sellerPage.waitForURL(/\/auctions\/create$/);
    await expect(
      sellerPage.getByRole('heading', { name: /Create New Auction Listing/i }),
    ).toBeVisible();

    const auctionTitle = `Vintage Chronograph Watch ${timestamp}`;
    await sellerPage.locator('#title').fill(auctionTitle);
    await sellerPage
      .locator('#description')
      .fill('Rare collectors timepiece with certified provenance and box.');
    await sellerPage.locator('#startingPrice').fill('100');
    await sellerPage.locator('#minIncrement').fill('10');
    await sellerPage.getByRole('button', { name: /Publish Listing/i }).click();

    // Redirection to the live auction room
    await sellerPage.waitForURL(/\/auctions\/[a-f0-9-]+$/);
    const auctionRoomUrl = sellerPage.url();

    // Verify initial auction state on Seller's page
    await expect(sellerPage.getByText(auctionTitle)).toBeVisible();
    await expect(sellerPage.getByText(/\$100(\.00)?/).first()).toBeVisible();
    await expect(sellerPage.getByText(/Your Listing/i)).toBeVisible();

    // ----------------------------------------------------
    // Context 2: Buyer (User B)
    // ----------------------------------------------------
    const buyerContext = await browser.newContext();
    const buyerPage = await buyerContext.newPage();
    const buyerEmail = `buyer-${timestamp}@example.com`;

    // 3. Buyer registers
    await buyerPage.goto(`${targetUrl}/register`);
    await buyerPage.locator('#name').fill('Buyer Bob');
    await buyerPage.locator('#email').fill(buyerEmail);
    await buyerPage.locator('#password').fill('Password123!');
    await buyerPage.locator('#role').selectOption('BUYER');
    await buyerPage.getByRole('button', { name: /Create Account/i }).click();
    await buyerPage.waitForURL(/\/auctions$/);

    // 4. Buyer visits the live auction room via client navigation from /auctions
    await buyerPage
      .locator(`a[href*="/auctions/"]`)
      .filter({ hasText: auctionTitle })
      .first()
      .click();
    await buyerPage.waitForURL(auctionRoomUrl);
    await expect(buyerPage.getByText(auctionTitle)).toBeVisible();
    await expect(buyerPage.getByText(/\$100(\.00)?/).first()).toBeVisible();

    // 5. Buyer places a bid of $120
    const bidInput = buyerPage.locator('input[type="number"]');
    await bidInput.fill('120');
    await buyerPage.locator('form button[type="submit"]').click();

    // Buyer sees accepted bid and high-bidder banner
    await expect(buyerPage.getByText(/\$120(\.00)?/).first()).toBeVisible({ timeout: 10000 });
    await expect(buyerPage.getByText(/You currently hold the highest bid/i)).toBeVisible();

    // 6. Live update in second context:
    // Seller's open page must receive the live WebSocket broadcast and update to $120 without reloading
    await expect(sellerPage.getByText(/\$120(\.00)?/).first()).toBeVisible({ timeout: 10000 });
    await expect(sellerPage.getByText('Buyer Bob', { exact: true })).toBeVisible({ timeout: 10000 });

    await sellerContext.close();
    await buyerContext.close();
  });

  test('Flow 2: outbid and rollback', async ({ browser, baseURL }) => {
    const targetUrl = baseURL || 'http://localhost:8080';

    // Context 1: Seller creates listing
    const sellerContext = await browser.newContext();
    const sellerPage = await sellerContext.newPage();
    const timestamp = Date.now();

    await sellerPage.goto(`${targetUrl}/register`);
    await sellerPage.locator('#name').fill('Seller Sam');
    await sellerPage.locator('#email').fill(`seller-sam-${timestamp}@example.com`);
    await sellerPage.locator('#password').fill('Password123!');
    await sellerPage.locator('#role').selectOption('SELLER');
    await sellerPage.getByRole('button', { name: /Create Account/i }).click();
    await sellerPage.waitForURL(/\/auctions$/);

    await sellerPage
      .getByRole('navigation')
      .getByRole('link', { name: /Create Auction/i })
      .click();
    await sellerPage.waitForURL(/\/auctions\/create$/);
    const auctionTitle = `Collector Stamp Set ${timestamp}`;
    await sellerPage.locator('#title').fill(auctionTitle);
    await sellerPage
      .locator('#description')
      .fill('Original 19th century historical postage stamps.');
    await sellerPage.locator('#startingPrice').fill('100');
    await sellerPage.locator('#minIncrement').fill('10');
    await sellerPage.getByRole('button', { name: /Publish Listing/i }).click();
    await sellerPage.waitForURL(/\/auctions\/[a-f0-9-]+$/);
    const auctionRoomUrl = sellerPage.url();

    // Context 2: Buyer 1 (Charlie)
    const buyer1Context = await browser.newContext();
    const buyer1Page = await buyer1Context.newPage();
    await buyer1Page.goto(`${targetUrl}/register`);
    await buyer1Page.locator('#name').fill('Buyer Charlie');
    await buyer1Page.locator('#email').fill(`buyer-charlie-${timestamp}@example.com`);
    await buyer1Page.locator('#password').fill('Password123!');
    await buyer1Page.locator('#role').selectOption('BUYER');
    await buyer1Page.getByRole('button', { name: /Create Account/i }).click();
    await buyer1Page.waitForURL(/\/auctions$/);

    await buyer1Page
      .locator(`a[href*="/auctions/"]`)
      .filter({ hasText: auctionTitle })
      .first()
      .click();
    await buyer1Page.waitForURL(auctionRoomUrl);
    await expect(buyer1Page.getByText(auctionTitle)).toBeVisible();

    // Buyer 1 places initial bid of $110
    const bidInput1 = buyer1Page.locator('input[type="number"]');
    await bidInput1.fill('110');
    await buyer1Page.locator('form button[type="submit"]').click();
    await expect(buyer1Page.getByText(/\$110(\.00)?/).first()).toBeVisible({ timeout: 10000 });
    await expect(buyer1Page.getByText(/You currently hold the highest bid/i)).toBeVisible();

    // Context 3: Buyer 2 (Diana)
    const buyer2Context = await browser.newContext();
    const buyer2Page = await buyer2Context.newPage();
    await buyer2Page.goto(`${targetUrl}/register`);
    await buyer2Page.locator('#name').fill('Buyer Diana');
    await buyer2Page.locator('#email').fill(`buyer-diana-${timestamp}@example.com`);
    await buyer2Page.locator('#password').fill('Password123!');
    await buyer2Page.locator('#role').selectOption('BUYER');
    await buyer2Page.getByRole('button', { name: /Create Account/i }).click();
    await buyer2Page.waitForURL(/\/auctions$/);

    await buyer2Page
      .locator(`a[href*="/auctions/"]`)
      .filter({ hasText: auctionTitle })
      .first()
      .click();
    await buyer2Page.waitForURL(auctionRoomUrl);
    await expect(buyer2Page.getByText(auctionTitle)).toBeVisible();

    // Buyer 2 outbids Buyer 1 with $150
    const bidInput2 = buyer2Page.locator('input[type="number"]');
    await bidInput2.fill('150');
    await buyer2Page.locator('form button[type="submit"]').click();
    await expect(buyer2Page.getByText(/\$150(\.00)?/).first()).toBeVisible({ timeout: 10000 });
    await expect(buyer2Page.getByText(/You currently hold the highest bid/i)).toBeVisible();

    // Outbid check: Buyer 1's page observes live update to $150 and loses high-bidder status
    await expect(buyer1Page.getByText(/\$150(\.00)?/).first()).toBeVisible({ timeout: 10000 });
    await expect(buyer1Page.getByText(/You currently hold the highest bid/i)).not.toBeVisible();

    // Rollback check:
    // Intercept Buyer 1's next bid submission to simulate server rejection / 409 Conflict
    await buyer1Page.route('**/api/auctions/*/bids', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            statusCode: 409,
            message: 'Outbid: A higher bid has already been accepted.',
            timestamp: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Buyer 1 attempts a bid of $160
    await bidInput1.fill('160');
    await buyer1Page.locator('form button[type="submit"]').click();

    // Verify error notification is displayed
    await expect(
      buyer1Page.getByText(/Outbid: A higher bid has already been accepted/i),
    ).toBeVisible({ timeout: 10000 });

    // Verify state rollback: current price reverts/remains at $150
    await expect(buyer1Page.getByText(/\$150(\.00)?/).first()).toBeVisible();

    await sellerContext.close();
    await buyer1Context.close();
    await buyer2Context.close();
  });
});
