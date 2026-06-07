import { test, expect } from '@testrelic/playwright-analytics/fixture';

test.describe('auth', () => {
  test('user can log in with valid credentials', async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('#email', 'founder@demo.test');
    await page.fill('#password', 'correcthorse');
    await expect(page.locator('#login-submit')).toBeEnabled();
    await page.click('#login-submit');
    await expect(page).toHaveURL(/\/checkout/);
  });

  test('login form rejects an incorrect password', async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('#email', 'founder@demo.test');
    await page.fill('#password', 'short');
    await expect(page.locator('#login-submit')).toBeDisabled();
  });
});
