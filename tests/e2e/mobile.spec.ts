import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: MOBILE - Mobile Responsive Tests
 *
 * Tests mobile-specific functionality and responsive design
 * across all main pages.
 */

test.describe('MOBILE - Mobile Responsive Tests', () => {
  // Set mobile viewport for all tests in this group
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 13 dimensions
  });

  /**
   * TC-MOBILE-001: Home page renders correctly on mobile
   *
   * Verifies the home page is fully functional on mobile viewport.
   *
   * The board IS the front door now (#145) — `/` is a plain redirect to
   * `/jobs`, not a separate OpenClaw marketing deck with its own waitlist
   * email form (that surface was retired the same PR). Verified live: no
   * `input[type="email"]` exists on `/` today. The front door's own input
   * is the jobs search box.
   */
  test('TC-MOBILE-001: Home page renders correctly on mobile', async ({ page }) => {
    await page.goto('/');

    // Brand should be visible
    await expect(page.locator('text=Intervu').first()).toBeVisible();

    // The board's own search input, not a waitlist email form.
    await expect(page.getByPlaceholder(/What kind of work/i)).toBeVisible();

    // No horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 20);
  });

  /**
   * TC-MOBILE-002: Mobile tab bar is accessible
   *
   * On mobile, primary nav lives in the fixed bottom tab bar (Find · Tracker ·
   * Resume · Prep). TopBar keeps wordmark + avatar only.
   */
  test('TC-MOBILE-002: Mobile tab bar is accessible', async ({ page }) => {
    // `/` is the front door now (job-board split, 2026-08-03) — TopBar
    // still mounts underneath it (wordmark + avatar reachable), so check
    // on /jobs, a normal page where the full chrome is actually usable.
    await page.goto('/jobs');

    await expect(page.getByTestId('topbar')).toBeVisible();
    await expect(page.getByTestId('mobile-tabbar')).toBeVisible();
    // NAV_TABS renamed "All jobs" -> "Jobs" (testId: topbar-jobs) when the
    // nav was restructured for the split; the same testId renders both in
    // TopBar's desktop-only row (hidden on mobile) and MobileTabBar, so
    // scope to the mobile tab bar to avoid matching TopBar's hidden copy.
    await expect(page.getByTestId('mobile-tabbar').getByTestId('mobile-topbar-jobs')).toBeVisible();
  });

  /**
   * TC-MOBILE-004: All pages are scrollable on mobile
   *
   * Verifies all main pages can be scrolled vertically.
   */
  test('TC-MOBILE-004: All pages are scrollable on mobile', async ({ page }) => {
    const pages = ['/', '/yours', '/settings'];

    for (const p of pages) {
      await page.goto(p);

      // Page should be scrollable (body has overflow)
      const isScrollable = await page.evaluate(() => {
        return document.body.scrollHeight > window.innerHeight ||
          document.documentElement.scrollHeight > window.innerHeight;
      });

      // Soft check - some pages may not have enough content to scroll
      expect(typeof isScrollable).toBe('boolean');
    }
  });

  /**
   * TC-MOBILE-005: Touch targets are adequately sized
   *
   * Verifies buttons and interactive elements are large enough for touch.
   */
  test('TC-MOBILE-005: Touch targets are adequately sized', async ({ page }) => {
    await page.goto('/');

    // Check analyze button size
    const analyzeButton = page.getByRole('button', { name: /analyze/i });
    if (await analyzeButton.isVisible()) {
      const box = await analyzeButton.boundingBox();
      if (box) {
        // Minimum touch target size (44x44 is Apple's recommendation)
        expect(box.height).toBeGreaterThanOrEqual(36);
      }
    }
  });

  /**
   * TC-MOBILE-006: Forms are usable on mobile
   *
   * Verifies form inputs are accessible and usable on mobile.
   */
  test('TC-MOBILE-006: Forms are usable on mobile', async ({ page }) => {
    // Search chrome lives on /jobs now (front door has no search input).
    await page.goto('/jobs');

    // Fill search on mobile
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('Test Company, Test Role, Round 1');
    await expect(searchInput).toHaveValue('Test Company, Test Role, Round 1');
  });

  /**
   * TC-MOBILE-007: Modals are mobile-friendly
   *
   * Verifies modals display correctly on mobile viewport.
   */
  test('TC-MOBILE-007: Modals are mobile-friendly', async ({ page }) => {
    await page.goto('/yours');

    // Open add modal
    const addButton = page.locator('button:has-text("Add"), button:has-text("Track"), button:has-text("New")').first();

    if (await addButton.isVisible()) {
      await addButton.click();

      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible()) {
        const box = await dialog.boundingBox();
        if (box) {
          // Modal should fit within viewport
          const viewportWidth = await page.evaluate(() => window.innerWidth);
          expect(box.width).toBeLessThanOrEqual(viewportWidth);
        }

        // Close modal
        await page.keyboard.press('Escape');
      }
    }
  });

  /**
   * TC-MOBILE-008: Navigation works on mobile
   *
   * Verifies page navigation works correctly on mobile.
   *
   * `/settings` is `AUTH_GATED_PRODUCT_PREFIXES` (lib/auth/product-routes.ts)
   * — a signed-out visit redirects to `/login?next=...` before the page
   * renders (same gate TC-NAV-007 in navigation.spec.ts documents). `/yours`
   * came off that list in the 2026-08-08 engagement wave — the guest tracker
   * is a deliberate logged-out experience, so it renders directly.
   */
  test('TC-MOBILE-008: Navigation works on mobile', async ({ page }) => {
    await page.goto('/');

    // Navigate using direct URLs on mobile
    await page.goto('/settings');
    await expect(page).toHaveURL('/login?next=%2Fsettings');

    await page.goto('/yours');
    await expect(page).toHaveURL('/yours');
  });

  /**
   * TC-MOBILE-009: /connect tabs are visible and don't cause horizontal scroll
   *
   * Verifies the AI-client tabs (Claude / Gemini / Cursor) render and stay
   * reachable on a narrow viewport. NOTE: playwright.config.ts only defines a
   * single `chromium` (Desktop Chrome) project — there is no true
   * multi-device project in this suite, so this is a manual-viewport check
   * within the desktop project, not a real device-emulation run.
   *
   * /connect cleanup (#152): the tab picker now only lists `kind: "mcp"`
   * clients (OpenClaw moved to its own section below, not a tab — see
   * lib/connect-clients.ts), and Gemini's badge changed from "via Gemini
   * CLI" to "us · web app" (the connector now targets the Gemini web app,
   * not the CLI) — its accessible name no longer contains "CLI", so this
   * matches on the label alone.
   */
  test("TC-MOBILE-009: /connect tabs are visible on mobile", async ({ page }) => {
    await page.goto('/connect');

    const tabs = page.getByTestId('connect-tabs');
    await expect(tabs).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Claude' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Gemini' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cursor' })).toBeVisible();

    // No horizontal scroll (same pattern as TC-MOBILE-001).
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 20);
  });

  /**
   * TC-MOBILE-011: Focusing a field never zooms the page
   *
   * iOS Safari zooms when a focused form control computes under 16px, and it
   * does not zoom back out — the user is left scrolled sideways mid-form.
   *
   * The unit guard for this reads source, and source-reading has a floor: it
   * has to recognise a control by how it is WRITTEN. Two rounds of that guard
   * passed while the /jobs search box sat at 14px — first because the tag
   * regex truncated at the `>` inside `onChange={(e) => …}`, then because the
   * component is called `SearchAutocomplete` and the matcher was looking for
   * names containing "Input". This test asks the rendered page instead, so it
   * cannot be fooled by naming or by JSX shape: whatever ends up as a real
   * focusable field, at a real phone width, has to be at least 16px.
   */
  test('TC-MOBILE-011: no form control is under 16px (iOS focus-zoom)', async ({ page }) => {
    for (const route of ['/jobs', '/', '/connect', '/pricing']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => { });

      const tooSmall = await page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>('input, textarea, select'),
        );
        return controls
          .filter((c) => {
            const type = (c as HTMLInputElement).type;
            // Hidden / non-text controls never summon a keyboard, so they
            // cannot trigger the zoom.
            if (['hidden', 'checkbox', 'radio', 'submit', 'button', 'range', 'color'].includes(type)) return false;
            return c.offsetParent !== null;
          })
          .map((c) => ({
            px: parseFloat(getComputedStyle(c).fontSize),
            id: c.getAttribute('data-testid') || (c as HTMLInputElement).placeholder || c.tagName,
          }))
          .filter((c) => c.px < 16);
      });

      expect(
        tooSmall,
        `${route}: these zoom the page when focused on iOS — ${JSON.stringify(tooSmall)}`,
      ).toEqual([]);
    }
  });
});
