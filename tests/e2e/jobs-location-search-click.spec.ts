import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-LOCATION-SEARCH-CLICK — front-door wave (2026-09-22)
 *
 * Live-measured prod bug: typing a location and clicking the Search button —
 * never pressing Enter, never picking a suggestion — silently dropped the
 * location. The URL carried only `?q=`, the IP-based default location chip
 * ("Canada · Remote" style) filtered the results instead, and the location
 * box kept displaying the dead draft text, so the page LOOKED filtered to
 * the typed place while ignoring it.
 *
 * Two code paths conspired (see `submitSearch` and `applyFilterState` in
 * app/jobs/page.tsx):
 *   1. The Search button lives outside LocationCombobox, whose Enter/blur
 *      handlers were the only commit paths — a submit never flushed the
 *      typed draft.
 *   2. Even when blur DID commit first, the submit's URL push was built from
 *      a stale render closure and the URL reconcile effect then wiped the
 *      just-committed place.
 *
 * The sibling specs (jobs-location-work-mode, jobs-renamed-city) cover the
 * Enter-commit path only; this one covers the click path. It asserts on the
 * URL and the default chip — unlike those specs, the URL shape here IS the
 * contract under test, because the bug was precisely that the URL never
 * received the place.
 */
test.describe('JOBS-LOCATION-SEARCH-CLICK', () => {
    test('typed-but-unselected location survives a Search-button submit', async ({ page }) => {
        await page.goto('/jobs?posted=any');

        const queryBox = page.getByTestId('search-input').or(page.getByPlaceholder('Job title, skill, or company'));
        await expect(queryBox.first()).toBeVisible();
        await queryBox.first().fill('product manager');

        const locationBox = page.getByTestId('location-input');
        await expect(locationBox).toBeVisible();
        await locationBox.fill('Toronto');
        // Deliberately NO Enter and NO suggestion pick — straight to the button.
        await page.getByTestId('search-submit').click();

        // The typed place must reach the URL (its facet param), and the
        // IP-default chip must stand down for the explicit choice.
        await expect(page).toHaveURL(/Toronto/i, { timeout: 15_000 });
        await expect(page.getByTestId('default-location-chip')).toHaveCount(0);

        // And the results surface reflects a real filtered search, not the
        // at-rest default feed.
        await expect(page.getByTestId('job-row').first()).toBeVisible({ timeout: 15_000 });
    });
});
