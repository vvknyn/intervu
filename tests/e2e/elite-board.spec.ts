import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: ELITE-BOARD — Milestone 1 smoke
 *
 * Environment-tolerant: follows jobs-search-polish / jobs-first-screen skip
 * patterns when Meilisearch is unconfigured or the corpus returns no rows.
 * Board chips render only in browse mode (not the first-paint ask screen), so
 * tests enter via `posted=any` rather than bare `/`.
 */

async function enterBrowseMode(page: Page) {
    await page.goto('/?posted=any');
    await expect(
        page
            .getByRole('listbox', { name: 'Job results' })
            .or(page.getByText(/Job search is being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/Job search is temporarily unavailable/i))
            .first(),
    ).toBeVisible({ timeout: 30_000 });
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

    test('elite board chip toggles URL', async ({ page }) => {
        await enterBrowseMode(page);

        const chip = page.getByTestId('board-chip-elite');
        await expect(chip).toBeVisible();

        await chip.click();
        await expect(page).toHaveURL(/board=elite/);

        await chip.click();
        await expect(page).not.toHaveURL(/board=elite/);
    });

    test('am I a fit control is on rows when results exist', async ({ page }) => {
        await enterBrowseMode(page);

        const row = page.getByTestId('job-row').first();
        if ((await row.count()) === 0) {
            test.skip(true, 'No job rows — backend unconfigured or empty corpus');
        }

        await expect(row).toBeVisible({ timeout: 30_000 });
        await expect(row.getByTestId('am-i-a-fit')).toBeVisible();
    });
});
