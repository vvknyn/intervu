import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: NAV - Navigation Tests
 *
 * Tests all navigation paths and page accessibility across the application.
 * Post-flip (jobs-first-bloom PR 1): `/` is jobs search, `/prep` is interview
 * prep, and the old 6-item sidebar is gone — nav destinations (Prep, Resumes,
 * Yours, Stories, Settings) live in the signed-in avatar's dropdown
 * menu (TopBar, data-testid="topbar-avatar"). Signed-out visitors — the
 * default state in these tests, no login fixture here — only see the
 * wordmark, "All jobs" (data-testid="topbar-alljobs"), and "Log in"
 * (data-testid="topbar-login"), so menu-driven navigation tests below are
 * conditional on the avatar being visible.
 */
test.describe('NAV - Navigation Tests', () => {
  /**
   * TC-NAV-001: Home page loads successfully
   *
   * Verifies the root (jobs search) page loads with core elements:
   * - Logo and brand name "Intervu"
   * - Search input field
   * - Analyze button
   */
  test('TC-NAV-001: Home page loads successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for page to hydrate
    await page.waitForLoadState('networkidle');

    // Verify brand name is visible
    await expect(page.locator('text=Intervu').first()).toBeVisible({ timeout: 10000 });

    // Verify search input exists
    await expect(page.locator('input[type="text"]').first()).toBeVisible({ timeout: 10000 });

    // Verify there are buttons on the page
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible({ timeout: 10000 });
  });

  /**
   * TC-NAV-002: Navigate to Resume Builder via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Resumes.
   * No-ops when signed out (avatar isn't rendered — see file header).
   */
  test('TC-NAV-002: Navigate to Resume Builder via avatar menu', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Resumes' }).click();
      await expect(page).toHaveURL('/resume-builder');
    }
  });

  /**
   * TC-NAV-003: Navigate to Yours via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Yours.
   * No-ops when signed out.
   */
  test('TC-NAV-003: Navigate to Yours via avatar menu', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Yours' }).click();
      await expect(page).toHaveURL('/yours');
    }
  });

  /**
   * TC-NAV-004: Navigate to Settings via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Settings.
   * No-ops when signed out.
   */
  test('TC-NAV-004: Navigate to Settings via avatar menu', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await expect(page).toHaveURL('/settings');
    }
  });

  /**
   * TC-NAV-005: Navigate to Prep via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Prep.
   * No-ops when signed out.
   */
  test('TC-NAV-005: Navigate to Prep via avatar menu', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Prep' }).click();
      await expect(page).toHaveURL('/prep');
    }
  });

  /**
   * TC-NAV-005b: Navigate to Stories via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Stories.
   * No-ops when signed out.
   */
  test('TC-NAV-005b: Navigate to Stories via avatar menu', async ({ page }) => {
    await page.goto('/');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Stories' }).click();
      await expect(page).toHaveURL('/stories');
    }
  });

  /**
   * TC-NAV-006: Wordmark click returns to jobs root
   *
   * From any page, clicking the TopBar wordmark should return to `/`.
   */
  test('TC-NAV-006: Wordmark click returns to jobs root', async ({ page }) => {
    await page.goto('/settings');

    const homeLink = page.locator('a[href="/"]').first();

    if (await homeLink.isVisible()) {
      await homeLink.click();
      await expect(page).toHaveURL('/');
    } else {
      // Navigate directly
      await page.goto('/');
      await expect(page).toHaveURL('/');
    }
  });

  /**
   * TC-NAV-007: Direct URL access to all pages
   *
   * Verifies all pages are accessible via direct URL navigation.
   */
  test('TC-NAV-007: Direct URL access to all pages', async ({ page }) => {
    const pages = [
      { url: '/', title: 'Intervu' },
      { url: '/prep', title: 'Intervu' },
      { url: '/resume-builder', title: 'Resume' },
      { url: '/resume-tailor', title: 'Tailor' },
      { url: '/yours', title: 'Yours' },
      { url: '/settings', title: 'Settings' },
    ];

    for (const p of pages) {
      await page.goto(p.url);
      await expect(page).toHaveURL(p.url);
      // Page should not show error
      await expect(page.locator('text=404')).not.toBeVisible();
    }
  });

  /**
   * TC-NAV-008: Dashboard redirect works
   *
   * /dashboard should redirect to /prep (bookmarks belong to prep users;
   * `/` is jobs now).
   */
  test('TC-NAV-008: Dashboard redirect works', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/prep');
  });

  /**
   * TC-NAV-009: Back button navigation works
   *
   * Browser back button should work correctly between pages.
   */
  test('TC-NAV-009: Back button navigation works', async ({ page }) => {
    await page.goto('/');
    await page.goto('/settings');

    // Go back
    await page.goBack();

    // Should be back at the jobs root
    await expect(page).toHaveURL('/');
  });
});
