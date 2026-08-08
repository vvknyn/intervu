import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-LOCATION-WORK-MODE — facet-capabilities wave (2026-08-08), F1 + F2
 *
 * Live-measured bugs this covers, at the /jobs board's location box
 * (`data-testid="location-input"`, `commitLocation` in page.tsx):
 *   - F1: typing "remote" wrote a raw `location_country = "remote"` exact
 *     filter — 0 rows, since no posting's country is literally "remote".
 *     Fixed by routing work-mode tokens to the `work_type` facet instead
 *     (`resolveLocationFacet`, lib/jobs/query-understanding.ts).
 *   - F2: typing "UK" resolved nothing (the gazetteer only recognized the
 *     full name "United Kingdom", not the abbreviation) — 0 rows. Fixed by
 *     a curated alias table (`PLACE_ALIASES`, lib/geo/resolve-place.ts).
 *
 * Both fixes are entirely server-side (the search request pipeline) — the
 * client's own URL state still round-trips the raw typed text
 * (`facets.location_country`), so these tests assert on the RESULT (real
 * job rows render, the "nothing matches" empty state does not), not on the
 * URL shape. `posted=any` keeps the default 30-day window from being the
 * reason a thin environment returns zero, isolating what's under test.
 */
test.describe('JOBS-LOCATION-WORK-MODE', () => {
    test('location box "remote" yields real results (work-mode routing, not a dead location_country filter)', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const locationBox = page.getByTestId('location-input');
        await expect(locationBox).toBeVisible();
        await locationBox.fill('remote');
        await locationBox.press('Enter');

        await expect(page.getByTestId('job-row').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Nothing matches these filters.')).toHaveCount(0);
        await expect(page.getByText('No roles match.')).toHaveCount(0);
    });

    test('location box "UK" yields real results (curated alias -> United Kingdom, not a dead gazetteer miss)', async ({ page }) => {
        await page.goto('/jobs?posted=any');
        const locationBox = page.getByTestId('location-input');
        await expect(locationBox).toBeVisible();
        await locationBox.fill('UK');
        await locationBox.press('Enter');

        await expect(page.getByTestId('job-row').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Nothing matches these filters.')).toHaveCount(0);
        await expect(page.getByText('No roles match.')).toHaveCount(0);
    });
});
