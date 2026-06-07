import { test, expect } from '@testrelic/playwright-analytics/fixture';

test.describe('signup', () => {
  test('new user can create an account', async ({ page }) => {
    await page.goto('/signup.html');
    await page.fill('#name', 'Alex Founder');
    await page.fill('#signup-email', 'alex@startup.test');
    await page.fill('#signup-password', 'securepass1');
    await page.click('button[type="submit"]');
    await expect(page.locator('#signup-success')).toContainText('Account created');
  });
});
