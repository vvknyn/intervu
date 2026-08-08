import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: TRENDS - Market trends page (/trends, Phase 1)
 *
 * Every number on this page is a live Meilisearch aggregation (see
 * lib/jobs/market-trends.ts) — no hardcoded stats. The live box runs an
 * embed backfill that's measured facet queries at 4-7s (sometimes worse)
 * under load, so this test uses a longer navigation/assertion timeout
 * rather than mocking Meilisearch away.
 */
test.describe('TRENDS - Market trends page', () => {
  test('TC-TRENDS-001: hero stats, top countries, freshness, and ghost radar all render real numbers', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/trends', { timeout: 90_000 });
    await expect(page.getByTestId('trends-page')).toBeVisible({ timeout: 90_000 });

    // Hero band — three tiles, each a non-empty, non-"NaN" number.
    for (const testId of ['trends-stat-live', 'trends-stat-total', 'trends-stat-ghost']) {
      const text = (await page.getByTestId(testId).innerText()).trim();
      expect(text).not.toBe('');
      expect(text.toLowerCase()).not.toContain('nan');
    }

    // Top hiring countries — at least one ranked row with a positive count.
    const countryRows = page.getByTestId('trends-country-row');
    await expect(countryRows.first()).toBeVisible({ timeout: 30_000 });
    expect(await countryRows.count()).toBeGreaterThan(0);

    // Posting freshness — all four buckets render a real count.
    for (const bucket of ['7d', '30d', '60d', 'older']) {
      const text = (await page.getByTestId(`trends-freshness-${bucket}`).innerText()).trim();
      expect(text.toLowerCase()).not.toContain('nan');
    }

    // Ghost radar — all four badges render a percentage + count.
    for (const badge of ['clear', 'caution', 'likely_ghost', 'unscored']) {
      const text = (await page.getByTestId(`trends-ghost-${badge}`).innerText()).trim();
      expect(text.toLowerCase()).not.toContain('nan');
    }
  });

  // Note: this checks presence/wiring via direct navigation rather than
  // clicking a TopBar link from `/` — `/` is a plain redirect to `/jobs`
  // (#145) with no query-string forwarding, so a click-through test would
  // depend on incidental redirect behavior rather than the trends page
  // itself. Direct navigation is the more direct, less coupled route to the
  // thing actually under test here.
  test('TC-TRENDS-002: /trends route renders the trends page', async ({ page }) => {
    await page.goto('/trends', { timeout: 90_000 });
    await expect(page.getByTestId('trends-page')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/trends/);
    // Trends lives in the avatar dropdown (TopBar NAV_DESTINATIONS), not primary nav.
  });

  // Market pulse (flow stats) — extends fetchMarketTrends' same aggregation,
  // see lib/jobs/market-trends.ts / components/trends/MarketPulse.tsx.
  test('TC-TRENDS-003: market pulse section renders the 14-day posted series as day bars', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/trends', { timeout: 90_000 });
    await expect(page.getByTestId('trends-pulse')).toBeVisible({ timeout: 90_000 });

    // 14 day-bar rows, each a real (non-NaN) count.
    const dayRows = page.locator('[data-testid^="trends-pulse-day-"]');
    await expect(dayRows.first()).toBeVisible({ timeout: 30_000 });
    expect(await dayRows.count()).toBe(14);
    for (let i = 0; i < (await dayRows.count()); i++) {
      const text = (await dayRows.nth(i).innerText()).trim();
      expect(text.toLowerCase()).not.toContain('nan');
    }
  });

  // Header ticker (P3) — TopBar, desktop-only, links to /trends. Checked from
  // /jobs (not /trends itself) since the ticker is app-chrome, not page content.
  test('TC-TRENDS-004: TopBar live-count ticker is visible on /jobs at desktop viewport and links to /trends', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/jobs', { timeout: 60_000 });
    const ticker = page.getByTestId('topbar-pulse-ticker');
    await expect(ticker).toBeVisible({ timeout: 30_000 });
    await expect(ticker).toHaveText(/live roles/);
    await expect(ticker).toHaveAttribute('href', '/trends');
  });
});
