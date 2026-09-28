import { test, expect, type Page } from '@playwright/test';
import { JOBS_VISITOR_COOKIE } from '../../src/lib/jobs-visitor-cookie';

/**
 * JOURNEY: signed-out visitor lands on /jobs (@J board-first).
 *
 * The regression this pins: a fresh anonymous visitor got the Concept A poster
 * (or, once `velai.onboarding.completed` was set, a bare search bar with zero
 * rows) instead of the searchable list, and every /jobs list event went to ~0.
 * The contract: on first paint the search input AND real job rows are on the
 * page, nothing modal or step-like stands in front of them, and asking for
 * sign-in never removes the board.
 *
 * Analytics are blocked from leaving the browser (PostHog, Cloudflare). The
 * telemetry ledger POST is *fulfilled locally* instead of aborted so the spec
 * can read the event names the page emitted (`captureEvent` fans out to
 * PostHog and the ledger at one chokepoint, events.ts). `captureEvent` is a
 * no-op unless the build had NEXT_PUBLIC_POSTHOG_KEY, so the event-capture
 * test runs only when that key is present in the runner's env — build with
 * it (any value) for a local `next build && next start` run.
 */

const ROW = '[data-testid="job-row"]';
const SEARCH_INPUT = 'input[placeholder="Job title, skill, or company"]';
const FIRST_PAINT_MS = 5_000;

const HAS_ANALYTICS_KEY = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

async function blockAnalytics(page: Page): Promise<string[]> {
  const ledgerEvents: string[] = [];
  await page.route(/\/ph\/|posthog\.com|cloudflareinsights/, (route) => route.abort());
  await page.route('**/api/telemetry', async (route) => {
    try {
      const body = route.request().postDataJSON() as { events?: { event_name: string }[] };
      for (const e of body.events ?? []) ledgerEvents.push(e.event_name);
    } catch {
      /* non-JSON beacon: nothing to record */
    }
    await route.fulfill({ status: 204 });
  });
  return ledgerEvents;
}

async function expectBoard(page: Page, timeout = FIRST_PAINT_MS) {
  await expect(page.locator(SEARCH_INPUT).first()).toBeVisible({ timeout });
  await expect
    .poll(() => page.locator(ROW).count(), { timeout, message: 'job rows on first paint' })
    .toBeGreaterThanOrEqual(5);
}

const VISITORS = [
  { name: 'fresh visitor (empty storage)', returning: false },
  { name: 'returning visitor (onboarding flag unset, previous-session cookie)', returning: true },
];

/** Blocks analytics, optionally plants the previous-session cookie, opens /jobs. */
async function openJobs(page: Page, baseURL: string | undefined, returning: boolean) {
  const ledgerEvents = await blockAnalytics(page);
  if (returning) {
    await page.context().addCookies([{ name: JOBS_VISITOR_COOKIE, value: '1', url: baseURL! }]);
  }
  await page.goto('/jobs');
  return ledgerEvents;
}

test.describe('JOURNEY @J signed-out /jobs is board-first', () => {
  for (const visitor of VISITORS) {
    test(`${visitor.name}: search box + 5 rows, row opens detail, Sign in keeps the board`, async ({ page, baseURL }) => {
      await openJobs(page, baseURL, visitor.returning);

      await expectBoard(page);
      await expect(page.locator('#concept-a-ssr, [data-testid="concept-a-landing"]')).toHaveCount(0);

      // Row click opens job detail: the canonical ?job= permalink plus the detail surface
      // (split pane on desktop, full-screen detail on mobile).
      await page.locator(`${ROW} [data-testid="job-title"]`).first().click();
      await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
      await expect(page.locator('[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible').first()).toBeVisible();
    });

    test(`${visitor.name}: board still visible 2s after Sign in`, async ({ page, baseURL }) => {
      await openJobs(page, baseURL, visitor.returning);
      await expectBoard(page);

      // Any visible "Sign in" / "Get started" control, by accessible name — not one testid.
      const cta = page.getByRole('button', { name: /^(sign in|get started)$/i }).or(
        page.getByRole('link', { name: /^(sign in|get started)$/i }),
      );
      await expect(cta.first()).toBeVisible();
      await cta.first().click();
      await page.waitForTimeout(2_000);

      await expectBoard(page, 1_000);
      await expect(page.locator('#concept-a-ssr, [data-testid="concept-a-landing"]')).toHaveCount(0);
    });
  }

  test('onboarding flag set (velai.onboarding.completed=1) still lands on the list with rows', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('velai.onboarding.completed', '1'));
    await openJobs(page, undefined, false);
    await expectBoard(page);
  });

  test('list analytics fire: results_impressed on first render, search_submitted on a search', async ({ page }) => {
    test.skip(!HAS_ANALYTICS_KEY, 'build has no NEXT_PUBLIC_POSTHOG_KEY, captureEvent is a no-op');
    const events = await openJobs(page, undefined, false);
    await expectBoard(page);

    await expect
      .poll(() => events, { timeout: 15_000, message: 'results_impressed after first render' })
      .toContain('results_impressed');

    await page.locator(SEARCH_INPUT).first().fill('engineer');
    await page.locator(SEARCH_INPUT).first().press('Enter');
    await expect
      .poll(() => events, { timeout: 15_000, message: 'search_submitted after a search' })
      .toContain('search_submitted');
  });
});
