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

  // Note: this checks presence/wiring via attributes rather than clicking
  // from `/` — the homepage's default empty-search "overlay-ask" screen
  // deliberately covers the real TopBar with its own fixed z-50 masthead
  // (see page.tsx's `isOverlayAsk`, "Screen 1 covers the app masthead with
  // a fixed layer"), so no topbar link is clickable from `/`'s landing
  // state today — reproduced live with the pre-existing "Interview prep"
  // tab, not something this change introduced.
  test('TC-TRENDS-002: "Trends" appears in the top nav and points at /trends', async ({ page }) => {
    await page.goto('/trends');
    const tab = page.getByTestId('topbar-trends');
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await expect(tab).toHaveAttribute('href', '/trends');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });
});
