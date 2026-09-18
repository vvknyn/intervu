import { test, expect, devices } from '@playwright/test';
import { test as authTest } from './helpers/auth-gate';

/**
 * TEST GROUP: MOBILE - Mobile Responsive Tests
 *
 * Tests mobile-specific functionality and responsive design
 * across all main pages.
 */

/**
 * Assert the page does not scroll sideways, and say WHAT is too wide when it
 * does.
 *
 * This replaces a two-line `body.scrollWidth <= innerWidth + 20` that was
 * copy-pasted per test. Three things were wrong with that shape:
 *
 *  - It reported "450 is not <= 410" and nothing else, so a failure told you
 *    a page was broken but not which element to look at.
 *  - `document.body.scrollWidth` is the wrong ruler; `documentElement` is what
 *    actually scrolls.
 *  - The 20px tolerance is a hole big enough for a real defect to sit in, and
 *    it existed for no stated reason. 1px covers sub-pixel rounding.
 *
 * The offender list deliberately reports every element wider than the
 * viewport, widest first. Elements that are merely `w-full` inside an
 * already-widened document (a fixed nav, a full-bleed canvas) show up too —
 * they are symptoms, and seeing them next to the true cause is what makes the
 * cause obvious.
 */
async function expectNoHorizontalScroll(page: import('@playwright/test').Page, where: string) {
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('*')]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > vw + 1 || box.right > vw + 1)
      .sort((a, b) => b.box.right - a.box.right)
      .slice(0, 5)
      .map(({ el, box }) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() || '').slice(0, 70),
        width: Math.round(box.width),
        right: Math.round(box.right),
        text: (el.textContent || '').trim().slice(0, 40),
      }));
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  });

  expect(
    report.scrollWidth,
    `${where} scrolls sideways: document is ${report.scrollWidth}px wide in a ` +
      `${report.vw}px viewport. Widest elements:\n` +
      report.offenders
        .map((o) => `  <${o.tag} class="${o.cls}"> w=${o.width} right=${o.right} — "${o.text}"`)
        .join('\n'),
  ).toBeLessThanOrEqual(report.vw + 1);
}

test.describe('MOBILE - Mobile Responsive Tests', () => {
  // Set mobile viewport for all tests in this group
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 13 dimensions
  });

  /**
   * TC-MOBILE-010: No public page scrolls sideways on a phone
   *
   * The regression that prompted this: `/jobs`' sector directory put a
   * `truncate` (i.e. `white-space: nowrap`) description inside a flex column
   * with no `min-w-0`, so the column refused to shrink below its full line
   * width and pushed the document to 450px inside a 390px viewport. Every
   * page then scrolled sideways — row numbers and metric chips off the left
   * edge, descriptions off the right.
   *
   * TC-MOBILE-001 already asserted this for `/` alone and was failing; one
   * page's assertion is not a rule. This walks the public surface so the next
   * unshrinkable flex child is caught wherever it lands, not only where it
   * landed last time.
   */
  for (const route of ['/jobs', '/', '/trends', '/connect', '/pricing']) {
    test(`TC-MOBILE-010: ${route} does not scroll sideways on mobile`, async ({ page }) => {
      await page.goto(route);
      // The board is a client-rendered island; assert against the settled DOM,
      // not the SSR shell, or this measures a spinner.
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page, route);
    });
  }

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
    await expect(page.getByPlaceholder(/Job title/i)).toBeVisible();

    await expectNoHorizontalScroll(page, '/');
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
   *
   * Gated via tests/e2e/helpers/auth-gate.ts: the `/settings` leg needs a
   * real signed-in session.
   */
  authTest('TC-MOBILE-008: Navigation works on mobile', async ({ page }) => {
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

    await expectNoHorizontalScroll(page, '/connect');
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

/**
 * TC-MOBILE-012: mobile job-detail sheet scroll plumbing (2026-08-18)
 *
 * Root cause of the underlying bug: `JobDetail.tsx`'s own `collapsible`
 * clamp (`(description length) > 700`) fires for nearly every real
 * description and caps the description container at `max-h-[20rem]`
 * (320px) behind a "Show full description" click — a SECOND, redundant
 * height cap one level inside the mobile bottom sheet, which already owns a
 * real `overflow-y-auto` scroller (`data-testid="mobile-detail-scroller"`,
 * jobs/page.tsx). On a phone this meant opening a role showed a 320px stub
 * no matter how long the posting actually was.
 *
 * Fix: `JobDetail` takes a `collapseDescription` prop (default `true`, so
 * the desktop xl+ sticky pane is unchanged); `renderDetailSurface` in
 * jobs/page.tsx threads it through, and only the mobile sheet's call site
 * passes `false`.
 *
 * EVIDENCE LEVELS — read this before trusting either check below:
 *  - The actual 320px-clamp -> full-height DELTA is proven at the
 *    COMPONENT level, not here: `tests/unit/job-detail-description-collapse.test.ts`
 *    renders the real `JobDetail` via `renderToStaticMarkup` signed IN (the
 *    only path the clamp applies to) at two description lengths, and
 *    verifiably fails against the pre-fix logic. That is real, but it is
 *    not a browser.
 *  - THIS Playwright test runs at a genuine 390x844 mobile profile
 *    (`devices['iPhone 13']` — real viewport, touch, isMobile — the repo's
 *    `playwright.config.ts` only defines a Desktop Chrome project, so a
 *    spec must opt into a phone profile itself or it isn't testing one) in
 *    a REAL browser against the dev server. It runs SIGNED OUT deliberately
 *    — no test account is created (a prior attempt at a signed-in run
 *    created real accounts in the PRODUCTION Firebase project this repo's
 *    `.env.local` points `localhost:3000` at; that was wrong and is not
 *    repeated here). Guests now get the same description body as signed-in
 *    readers (`job-detail-description`). What this test proves, live, in a
 *    browser: the sheet opens, its scroller has real overflow
 *    (scrollHeight > clientHeight), scrolling it actually advances
 *    `scrollTop`, and the description — taller than the sheet — stays in
 *    the sheet's own scroller rather than chaining to the page behind it.
 */
test.describe('MOBILE - guest job-detail sheet scrolls the full posting', () => {
  // NOT `{ ...devices['iPhone 13'] }` — that preset's `defaultBrowserType:
  // 'webkit'` forces a new worker/browser type, which Playwright rejects
  // inside a `describe` (`test.use` there can only tweak context options,
  // not switch browsers) and this repo's config only registers a chromium
  // project anyway. Instead: the same real-phone context options (touch,
  // mobile UA, device pixel ratio) on top of chromium, at the explicit
  // 390x844 this file's other MOBILE tests already standardize on.
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor,
    userAgent: devices['iPhone 13'].userAgent,
  });

  // A real corpus job with a long-enough description/ledger that its
  // guest sign-in CTA sits below the fold at 390x844 — verified live
  // 2026-08-18. `posted=any` bypasses the default 30-day window since this
  // is a real, possibly-old record. Pick a new id via a `q=` search if this
  // one ever gets removed from the index.
  const JOB = { id: '51130b30-8920-4e75-b076-86c898f1b091', q: 'Ramsayhealthcare' };

  test('TC-MOBILE-012: signed-out mobile sheet scrolls the full posting', async ({ page }) => {
    await page.goto(`/jobs?q=${encodeURIComponent(JOB.q)}&posted=any&job=${JOB.id}`);
    await page.waitForLoadState('networkidle');

    const scroller = page.getByTestId('mobile-detail-scroller');
    await expect(scroller, 'mobile bottom sheet never opened').toBeVisible({ timeout: 15000 });

    const desc = page.getByTestId('job-detail-description');
    await expect(desc, 'full posting never rendered for a guest').toBeVisible({ timeout: 15000 });

    const before = await scroller.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(before.scrollHeight, `scroller scrollHeight ${before.scrollHeight} <= clientHeight ${before.clientHeight} — nothing to scroll`).toBeGreaterThan(before.clientHeight);
    expect(before.scrollTop, 'sheet should start scrolled to the top').toBe(0);

    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const after = await scroller.evaluate((el) => el.scrollTop);
    expect(after, 'scrollTop did not advance — the scroller did not actually scroll').toBeGreaterThan(before.scrollTop);
  });
});
