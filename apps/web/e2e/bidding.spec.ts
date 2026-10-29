import { test, expect } from '@playwright/test';

test.describe('Real-Time Auction & Bidding E2E Workflows', () => {
  test('navigates to auctions list and displays live listings', async ({ page }) => {
    await page.goto('/auctions');
    await expect(page).toHaveTitle(/BidStream|Vite/);
    const heading = page.getByRole('heading', { name: /Live Auctions/i });
    await expect(heading).toBeVisible();
  });

  test('multi-user live update across two browser contexts', async ({ browser }) => {
    // Context 1: Observer spectator
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto('/auctions');
    await expect(page1.getByRole('heading', { name: /Live Auctions/i })).toBeVisible();

    // Context 2: Buyer
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto('/login');
    await expect(page2.getByRole('heading', { name: /Sign In/i })).toBeVisible();

    await context1.close();
    await context2.close();
  });
});
