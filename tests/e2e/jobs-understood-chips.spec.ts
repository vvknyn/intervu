import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-UNDERSTOOD — typed words the server turns into filters
 * come back as ordinary chips (`understood` on the search result, merged into
 * FilterState + URL by JobsContent's `absorbUnderstood`).
 *
 * Needs a configured search backend (Meilisearch) AND the gazetteer; with the
 * backend unconfigured nothing is parsed into chips and this spec cannot pass.
 */
test.describe('JOBS-UNDERSTOOD', () => {
    test('"senior product manager remote canada" -> caption + chips; dismissing the place chip drops it from the URL', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const box = page.getByTestId('search-input').or(page.getByPlaceholder('Job title, skill, or company')).first();
        await expect(box).toBeVisible();
        await box.fill('senior product manager remote canada');
        await box.press('Enter');

        // The caption names what was searched, in the chips' own words.
        const note = page.getByTestId('understood-note');
        await expect(note).toBeVisible({ timeout: 20_000 });
        await expect(note).toContainText(/remote/i);
        await expect(note).toContainText('Canada');

        // The work mode and the place each land on an ordinary removable chip.
        await expect(page.getByTestId('active-filter-chip').filter({ hasText: 'Remote' })).toBeVisible();
        const placeChip = page.getByTestId('active-filter-chip').filter({ hasText: 'Canada' });
        await expect(placeChip).toBeVisible();
        await expect(page).toHaveURL(/work=remote/);
        await expect(page).toHaveURL(/country=Canada/);

        // The typed box now holds only the residual words.
        await expect(box).toHaveValue(/^senior product manager$/i);

        await placeChip.getByRole('button', { name: /Clear/ }).click();
        await expect(placeChip).toHaveCount(0);
        await expect(page).not.toHaveURL(/country=/);
        // Removing a chip is a search edit: the caption goes with it.
        await expect(note).toHaveCount(0);
    });
});
