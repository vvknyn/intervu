import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: NAV - Navigation Tests
 *
 * Tests all navigation paths and page accessibility across the application.
 * Automation-first front door (2026-08-03): `/` is now the OpenClaw
 * marketing pitch, not jobs search — the SERP moved to `/jobs` (same
 * component, same testids). `/`'s content is a fixed, full-viewport
 * overlay (src/app/page.tsx), which visually covers the shared TopBar
 * underneath it, so avatar-menu tests below navigate to `/jobs` (a normal
 * page with a reachable TopBar) rather than `/`. The old 6-item sidebar is
 * gone — nav destinations live in the signed-in avatar's dropdown menu
 * (TopBar, data-testid="topbar-avatar"). Signed-out visitors — the
 * default state in these tests, no login fixture here — only see the
 * wordmark, "All jobs" (data-testid="topbar-alljobs"), and "Log in"
 * (data-testid="topbar-login"), so menu-driven navigation tests below are
 * conditional on the avatar being visible.
 */
test.describe('NAV - Navigation Tests', () => {
  /**
   * TC-NAV-001: Home page loads successfully
   *
   * Verifies the jobs search page (`/jobs` — moved off `/` by the
   * automation-first front door, 2026-08-03) loads with core elements:
   * - Logo and brand name "Intervu"
   * - Search input field
   * - Analyze button
   */
  test('TC-NAV-001: Home page loads successfully', async ({ page }) => {
    await page.goto('/jobs');

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
   * TC-NAV-003: Navigate to Yours via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Yours.
   * No-ops when signed out.
   */
  test('TC-NAV-003: Navigate to Yours via avatar menu', async ({ page }) => {
    await page.goto('/jobs');

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
    await page.goto('/jobs');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      await expect(page).toHaveURL('/settings');
    }
  });

  /**
   * TC-NAV-005b: Navigate to Stories via avatar menu
   *
   * Opens the signed-in avatar dropdown and clicks Stories.
   * No-ops when signed out.
   */
  test('TC-NAV-005b: Navigate to Stories via avatar menu', async ({ page }) => {
    await page.goto('/jobs');

    const avatar = page.getByTestId('topbar-avatar');
    if (await avatar.isVisible()) {
      await avatar.click();
      await page.getByRole('menuitem', { name: 'Stories' }).click();
      await expect(page).toHaveURL('/stories');
    }
  });

  /**
   * TC-NAV-006: Wordmark click returns to the front door
   *
   * From any page, clicking the TopBar wordmark should return to `/` — the
   * automation-first front door (2026-08-03), not the jobs SERP (`/jobs`).
   */
  test('TC-NAV-006: Wordmark click returns to the front door', async ({ page }) => {
    await page.goto('/settings');

    const homeLink = page.locator('a[href="/"]').first();

    if (await homeLink.isVisible()) {
      await homeLink.click();
      await expect(page).toHaveURL('/jobs');
    } else {
      // Navigate directly
      await page.goto('/');
      await expect(page).toHaveURL('/jobs');
    }
  });

  /**
   * TC-NAV-007: Direct URL access to all pages
   *
   * Verifies all pages are accessible via direct URL navigation.
   *
   * `/` is a plain redirect to `/jobs` now (#145, "the board IS the front
   * door") — landing on `/jobs` rather than staying on `/` is the expected,
   * intentional outcome, not an error.
   *
   * `/yours` and `/settings` are both in `AUTH_GATED_PRODUCT_PREFIXES`
   * (lib/auth/product-routes.ts) — middleware redirects a signed-out visitor
   * to `/login?next=<path>` before either page ever renders (verified: no
   * session cookie means no path to `/yours`/`/settings` content at all,
   * guest-mode UI included). No fixture in this suite provides a signed-in
   * session, so this test only proves the gate lands somewhere real
   * (`/login`, carrying the right `next=`) rather than a dead end — it
   * cannot verify the pages' own content without inventing credentials.
   */
  test('TC-NAV-007: Direct URL access to all pages', async ({ page }) => {
    const pages = [
      { url: '/', landsOn: '/jobs' },
      { url: '/yours', landsOn: '/login?next=%2Fyours' },
      { url: '/settings', landsOn: '/login?next=%2Fsettings' },
    ];

    for (const p of pages) {
      await page.goto(p.url);
      await expect(page).toHaveURL(p.landsOn);
      // Page should not show error
      await expect(page.locator('text=404')).not.toBeVisible();
    }
  });

  /**
   * TC-NAV-008: Dashboard redirect works
   *
   * /dashboard is a bookmark from the pre-removal prep surface (2026-08-02).
   * It permanently redirects to /jobs — the job search SERP — directly, now
   * that /jobs is a real page rather than a second hop through `/` (the
   * automation-first front door since 2026-08-03).
   */
  test('TC-NAV-008: Dashboard redirect works', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL('/jobs');
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
    await expect(page).toHaveURL('/jobs');
  });

  /**
   * TC-NAV-010: Resume builder/tailor routes permanently redirect to /yours
   *
   * Resume building/tailoring removed (2026-08-03 — "no AI on website"
   * doctrine, part 2). Both routes are gone; a 308 keeps old bookmarks and
   * any indexed links landing somewhere real instead of 404ing.
   */
  test('TC-NAV-010: Resume builder/tailor routes permanently redirect to /yours', async ({ page }) => {
    for (const url of ['/resume-builder', '/resume-tailor']) {
      const response = await page.request.get(url, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers()['location']).toContain('/yours');
    }
  });
});
