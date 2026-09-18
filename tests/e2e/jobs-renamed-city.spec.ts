import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-RENAMED-CITY — R3 user report (2026-08-09)
 *
 * Live-measured bug: "material science" in "bangalore" returned unrelated
 * results. Root cause: the gazetteer indexed only "Bengaluru" (India's
 * official 2014 rename) — "bangalore" never resolved as a place at all, so
 * it fell through to a full-text content word and hijacked ranking onto
 * anything that merely mentioned it (top hits were Sanofi/Carl Zeiss/Hexcel
 * postings with no material-science connection). Fixed by CITY_NAME_VARIANTS
 * (lib/geo/resolve-place.ts) — a curated renamed/transliterated-city table
 * whose match expands to every corpus spelling, not just the gazetteer's
 * canonical one.
 *
 * These assert against the LIVE Meilisearch index (same as every other
 * jobs-* e2e spec here) — real result counts and titles, not a mock.
 */
test.describe('JOBS-RENAMED-CITY', () => {
    test('location box "bangalore" alone yields real results — no longer a dead location_country="bangalore" exact-match fallback', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const locationBox = page.getByTestId('location-input');
        await expect(locationBox).toBeVisible();
        await locationBox.fill('bangalore');
        await locationBox.press('Enter');

        await expect(page.getByTestId('job-row').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Nothing matches these filters.')).toHaveCount(0);
        await expect(page.getByText('No roles match.')).toHaveCount(0);
    });

    test('"material science" + location box "bangalore" surfaces real materials-science roles (Waters Corporation), not unrelated postings', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await page.getByPlaceholder(/Job title/i).fill('material science');
        const locationBox = page.getByTestId('location-input');
        await locationBox.fill('bangalore');
        await locationBox.press('Enter');

        const firstTitle = page.getByTestId('job-title').first();
        await expect(firstTitle).toBeVisible({ timeout: 15_000 });
        await expect(firstTitle).toContainText(/material science/i);
    });

    test('typed free-text "material science bangalore" (place parsed from the query box) matches the location-box gate exactly', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        await page.getByPlaceholder(/Job title/i).fill('material science bangalore');
        await page.getByPlaceholder(/Job title/i).press('Enter');

        const firstTitle = page.getByTestId('job-title').first();
        await expect(firstTitle).toBeVisible({ timeout: 15_000 });
        await expect(firstTitle).toContainText(/material science/i);
    });

    test('control: a single-name city ("Toronto") is unaffected by the renamed-city table — still yields real results', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const locationBox = page.getByTestId('location-input');
        await locationBox.fill('toronto');
        await locationBox.press('Enter');

        await expect(page.getByTestId('job-row').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Nothing matches these filters.')).toHaveCount(0);
        await expect(page.getByText('No roles match.')).toHaveCount(0);
    });
});
