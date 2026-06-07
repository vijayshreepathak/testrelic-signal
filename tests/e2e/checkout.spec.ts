import { test, expect } from '@testrelic/playwright-analytics/fixture';

/**
 * INTENTIONAL REALISTIC FAILURE: demo-app/app.js omits tax from #order-total.
 * Subtotal $100 + 8% tax = $108 expected; the bug shows $100.
 * This produces a rich failure for TestRelic AI (message + stack + screenshot).
 */
test.describe('checkout', () => {
  test('checkout applies 8% sales tax to the order total', async ({ page }) => {
    // Intentional demo-app bug — still fails for real TestRelic AI signal; marked
    // expected so CI stays green while the failure is ingested when uploading.
    test.fail();
    await page.goto('/checkout.html');
    const total = page.getByTestId('order-total');
    await expect(total).toHaveText('108');
  });

  test('checkout shows the free shipping banner over $50', async ({ page }) => {
    await page.goto('/checkout.html');
    await expect(page.getByTestId('shipping-banner')).toBeVisible();
    await expect(page.getByTestId('shipping-banner')).toContainText('Free shipping');
  });
});
