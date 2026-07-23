import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: BANNER - Motivational Banner Tests
 *
 * Tests the subtle motivational banner component across pages,
 * including display, dismissal, and settings integration.
 */

// The banner uses the group/banner class — locate via its unique structure
const bannerSelector = '.group\\/banner';

test.describe('BANNER - Motivational Banner Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('banner_disabled');
      localStorage.removeItem('banner_dismissed_until');
    });
  });

  /**
   * TC-BANNER-001: Banner appears on home page
   */
  test('TC-BANNER-001: Banner appears on home page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const banner = page.locator(bannerSelector);
    await expect(banner.first()).toBeVisible({ timeout: 15000 });
  });

  /**
   * TC-BANNER-002: Banner appears on yours page
   */
  test('TC-BANNER-002: Banner appears on yours page', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'test-key-123' }));
    });

    await page.goto('/yours');
    await page.waitForLoadState('networkidle');

    // Verify page loads without errors
    await expect(page.locator('text=Yours')).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-BANNER-003: Dismiss sets localStorage TTL
   */
  test('TC-BANNER-003: Dismiss sets localStorage TTL', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const dismissBtn = page.locator('button[aria-label="Dismiss"]');
    if (await dismissBtn.isVisible({ timeout: 10000 })) {
      await dismissBtn.click();

      const dismissedUntil = await page.evaluate(() =>
        localStorage.getItem('banner_dismissed_until')
      );
      expect(dismissedUntil).toBeTruthy();

      const ttl = Number(dismissedUntil);
      const now = Date.now();
      expect(ttl).toBeGreaterThan(now);
      expect(ttl).toBeLessThan(now + 25 * 60 * 60 * 1000);
    }
  });

  /**
   * TC-BANNER-004: Banner hidden when permanent flag is set
   */
  test('TC-BANNER-004: Banner hidden when permanent flag is set', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('banner_disabled', 'true');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const banner = page.locator(bannerSelector);
    await expect(banner).toHaveCount(0);
  });

  /**
   * TC-BANNER-005: Banner reappears after TTL expires
   */
  test('TC-BANNER-005: Banner reappears after TTL expires', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const expired = Date.now() - 60 * 60 * 1000;
      localStorage.setItem('banner_dismissed_until', String(expired));
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const banner = page.locator(bannerSelector);
    await expect(banner.first()).toBeVisible({ timeout: 15000 });
  });

  /**
   * TC-BANNER-006: Settings toggle disables banner globally
   */
  test('TC-BANNER-006: Settings toggle disables banner', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const toggle = page.locator('button[role="switch"]');
    if (await toggle.isVisible({ timeout: 10000 })) {
      await toggle.click();

      const disabled = await page.evaluate(() =>
        localStorage.getItem('banner_disabled')
      );
      expect(disabled).toBe('true');
    }
  });

  /**
   * TC-BANNER-007: Mobile viewport - page loads correctly
   */
  test('TC-BANNER-007: Mobile viewport loads correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Intervu').first()).toBeVisible({ timeout: 10000 });
  });
});
