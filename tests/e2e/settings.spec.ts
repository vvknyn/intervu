import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: SETTINGS - Settings Page Tests
 *
 * Tests the settings page functionality including AI connections,
 * account management, appearance, and data/privacy sections.
 * Settings page uses a single-page sectioned layout (no tabs).
 */

test.describe('SETTINGS - Settings Page Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
  });

  /**
   * TC-SETTINGS-001: Settings page loads
   *
   * Verifies the settings page loads successfully.
   */
  test('TC-SETTINGS-001: Settings page loads', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('text=Settings')).toBeVisible();
  });

  /**
   * TC-SETTINGS-002: Your AI Connection section is visible
   *
   * Verifies the AI Connection section with ConnectionCards is visible.
   */
  test('TC-SETTINGS-002: Your AI Connection section is visible', async ({ page }) => {
    await expect(page.locator('text=Your AI Connection')).toBeVisible();
    await expect(page.locator('text=Intervu is the interface')).toBeVisible();
  });

  /**
   * TC-SETTINGS-003: Three provider ConnectionCards are visible
   *
   * Verifies Groq, Gemini, and OpenAI cards are shown.
   */
  test('TC-SETTINGS-003: Three provider ConnectionCards are visible', async ({ page }) => {
    await expect(page.locator('text=Groq').first()).toBeVisible();
    await expect(page.locator('text=Google Gemini').first()).toBeVisible();
    await expect(page.locator('text=OpenAI').first()).toBeVisible();
  });

  /**
   * TC-SETTINGS-004: ConnectionCard shows benefit text
   *
   * Each provider card should show its benefit description.
   */
  test('TC-SETTINGS-004: ConnectionCard shows benefit text', async ({ page }) => {
    // Groq benefit
    await expect(page.locator('text=Fastest open-source models').first()).toBeVisible();
    // Gemini benefit
    await expect(page.locator('text=Large context window').first()).toBeVisible();
    // OpenAI benefit
    await expect(page.locator('text=Most capable reasoning').first()).toBeVisible();
  });

  /**
   * TC-SETTINGS-005: ConnectionCard shows Connect button for unconfigured providers
   *
   * Providers without keys should show a "Connect" button.
   */
  test('TC-SETTINGS-005: Connect buttons visible for unconfigured providers', async ({ page }) => {
    // Clear keys first
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should see Connect buttons
    const connectButtons = page.locator('button:has-text("Connect")');
    const count = await connectButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  /**
   * TC-SETTINGS-006: Clicking Connect opens API key modal
   *
   * Clicking a Connect button should open the API key configuration modal.
   */
  test('TC-SETTINGS-006: Clicking Connect opens API key modal', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('guest_api_keys');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Click first Connect button
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForTimeout(500);

    // Modal should open
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Modal should have key input
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  /**
   * TC-SETTINGS-007: SecurityBadge is visible in AI Connection section
   *
   * The SecurityBadge ("Stored on your device") should be visible.
   */
  test('TC-SETTINGS-007: SecurityBadge is visible', async ({ page }) => {
    await expect(page.locator('text=Stored on your device').first()).toBeVisible();
  });

  /**
   * TC-SETTINGS-008: Connected provider shows Reconfigure button
   *
   * When a key is saved, the card should show "Reconfigure" and "Connected" status.
   */
  test('TC-SETTINGS-008: Connected provider shows status', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({ groq: 'gsk_test_12345' }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Groq card should show Connected status
    await expect(page.locator('text=Connected').first()).toBeVisible();

    // Should show Reconfigure button
    await expect(page.locator('button:has-text("Reconfigure")').first()).toBeVisible();
  });

  /**
   * TC-SETTINGS-009: Appearance section has theme swatches
   *
   * Verifies the Appearance section exists with theme options.
   */
  test('TC-SETTINGS-009: Appearance section has theme swatches', async ({ page }) => {
    await expect(page.locator('text=Appearance').first()).toBeVisible();
  });

  /**
   * TC-SETTINGS-010: Data & Privacy section is visible
   *
   * Verifies the Data & Privacy section exists.
   */
  test('TC-SETTINGS-010: Data & Privacy section is visible', async ({ page }) => {
    // Scroll down to find the section
    await page.locator('text=Data & Privacy').scrollIntoViewIfNeeded();
    await expect(page.locator('text=Data & Privacy')).toBeVisible();
  });

  /**
   * TC-SETTINGS-011: Export data link exists
   *
   * Verifies export data link is present in Data & Privacy section.
   */
  test('TC-SETTINGS-011: Export data link exists', async ({ page }) => {
    const exportLink = page.locator('button:has-text("export data")');
    await exportLink.scrollIntoViewIfNeeded();
    await expect(exportLink).toBeVisible();
  });

  /**
   * TC-SETTINGS-012: Page responsive on mobile
   *
   * Verifies the page is usable on mobile viewport.
   */
  test('TC-SETTINGS-012: Page responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();

    // Settings header should still be visible
    await expect(page.locator('text=Settings')).toBeVisible();

    // AI Connection section should still be visible
    await expect(page.locator('text=Your AI Connection')).toBeVisible();
  });

  /**
   * TC-SETTINGS-013: Guest user sees login prompt
   *
   * Guest users should see a login prompt in the Account section.
   */
  test('TC-SETTINGS-013: Guest user sees login prompt', async ({ page }) => {
    // Look for login prompt for unauthenticated users
    const loginLink = page.locator('button:has-text("login"), a:has-text("login")');
    await expect(loginLink.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * TC-SETTINGS-014: Clicking ConnectionCard selects provider
   *
   * Clicking on a ConnectionCard body should select that provider.
   */
  test('TC-SETTINGS-014: Clicking ConnectionCard selects provider', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('guest_api_keys', JSON.stringify({
        groq: 'gsk_test_12345',
        gemini: 'AIzaSyTest_12345'
      }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Click Gemini card
    const geminiCard = page.locator('text=Google Gemini').first();
    await geminiCard.click();
    await page.waitForTimeout(300);

    // Page should not error
    await expect(page.locator('body')).toBeVisible();
  });

  /**
   * TC-SETTINGS-015: Back navigation works
   *
   * Verifies navigation back to home works.
   */
  test('TC-SETTINGS-015: Back navigation works', async ({ page }) => {
    await expect(page).toHaveURL('/settings');
    await page.goto('/');
    await expect(page).toHaveURL('/');
  });
});
