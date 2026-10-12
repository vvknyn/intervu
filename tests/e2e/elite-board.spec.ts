import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: ELITE-BOARD — Milestone 1 smoke
 *
 * Environment-tolerant: follows jobs-search-polish / jobs-first-screen skip
 * patterns when Meilisearch is unconfigured or the corpus returns no rows.
 * Board filter lives under Filters → Boards (not top-level chips), so tests
 * enter via `posted=any` and open the filters panel.
 */

async function enterBrowseMode(page: Page) {
    await page.goto('/?posted=any');
    await page.waitForLoadState('networkidle');

    // Browse-by-default (#152): there is no ask screen to wait out anymore —
    // `JobsAsk` (testid `jobs-ask`) is dead code, nothing renders it — a
    // zero-query/filtered landing goes straight to the toolbar+results
    // pipeline below.
    await expect(
        page
            .getByTestId('filters-toggle')
            .or(page.getByRole('region', { name: 'Job results' }))
            .or(page.getByText(/Job search is being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/Job search is temporarily unavailable/i))
            .first(),
    ).toBeVisible({ timeout: 30_000 });
}

async function openFilters(page: Page) {
    await page.getByTestId('filters-toggle').click();
    await expect(page.getByTestId('filters-panel')).toBeVisible({ timeout: 15_000 });
}

test.describe('ELITE-BOARD - Milestone 1 smoke', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* ignore */
            }
        });
    });

    test('elite board filter toggles URL', async ({ page }) => {
        await enterBrowseMode(page);
        await openFilters(page);

        const elite = page.getByTestId('board-filter-elite');
        await expect(elite).toBeVisible();

        await elite.click();
        await expect(page).toHaveURL(/board=elite/);

        const all = page.getByTestId('board-filter-all');
        await all.click();
        await expect(page).not.toHaveURL(/board=elite/);
    });

    // "am I a fit" row control removed 2026-08-02 — fit assessment moved to
    // MCP; the row no longer renders that control (degrade by omission, see
    // JobCard in src/app/page.tsx), so the smoke test asserting its presence
    // is gone with it.
});
