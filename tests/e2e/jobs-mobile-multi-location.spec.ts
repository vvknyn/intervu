import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-MOBILE-LOCATION - a phone can filter on more than one place
 *
 * The mobile location sheet held a single `country: string | null`, so
 * committing it REPLACED `location_country` with one value. Everything
 * underneath had carried a list from the start — the URL is `?country=a,b` and
 * `resolveLocationFacet` ORs a clause per value — and the sheet's own copy has
 * always said "Pick one or more". Only this control collapsed it, which is why
 * "Canada and remote" was unaskable from a phone while desktop could do it.
 *
 * `tests/unit/jobs-location-sheet.test.ts` pins the pure commit
 * (`applyLocationSheetDraft`) cheaply and exhaustively. This spec exists
 * because that function being right proves nothing about whether the sheet
 * WIRES it — the previous bug was equally a wiring bug, and a phone-sized
 * viewport is the only place this control exists at all.
 *
 * Environment-tolerant: it asserts on the committed FILTER (URL + chips),
 * never on result rows, so it holds whether or not Meilisearch is reachable.
 */

const PHONE = { width: 390, height: 844 }; // iPhone 14

test.describe('JOBS-MOBILE-LOCATION', () => {
    test.use({ viewport: PHONE });

    test('TC-LOC-MOBILE-001: two countries tapped in the sheet both survive Continue', async ({ page }) => {
        await page.goto('/jobs?q=engineer&posted=any');
        await page.waitForLoadState('domcontentloaded');

        await page.getByTestId('location-picker-trigger').click();
        await expect(page.getByTestId('location-sheet-country-canada')).toBeVisible();

        await page.getByTestId('location-sheet-country-canada').click();
        await page.getByTestId('location-sheet-country-united-states').click();
        await page.getByTestId('location-sheet-continue').click();

        // The filter is a LIST, in the order tapped.
        await expect(page).toHaveURL(/country=Canada%2CUnited\+States|country=Canada%2CUnited%20States/);

        // And it is visible and removable, one chip per place — the same
        // affordance desktop gets, on the row that renders at every width.
        const chips = page.getByTestId('active-filter-chip');
        await expect(chips.filter({ hasText: 'Canada' })).toHaveCount(1);
        await expect(chips.filter({ hasText: 'United States' })).toHaveCount(1);
    });

    test('TC-LOC-MOBILE-002: reopening the sheet shows every committed place, not the first', async ({ page }) => {
        // A case OTHER than the one that surfaced the bug: the sheet SEEDING
        // from `location_country[0]` was the second half of the same defect —
        // arriving on a two-place URL, a phone was shown one of them and
        // silently dropped the other on the next Continue. This also covers a
        // place with no popular row of its own, which is rendered from the
        // committed list rather than from the hardcoded country list.
        await page.goto('/jobs?q=engineer&posted=any&country=Canada,Toronto');
        await page.waitForLoadState('domcontentloaded');

        await page.getByTestId('location-picker-trigger').click();

        // Canada has a popular row; Toronto only exists because it is committed.
        // `Affordance` renders a CHECKBOX per row — it always did, which is
        // one of the three places the UI already promised multi-select while
        // the draft carried a single value (the copy and the `?country=a,b`
        // URL being the other two). Read the checkbox, not a styling hook.
        await expect(page.getByTestId('location-sheet-country-canada').locator('input')).toBeChecked();
        await expect(page.getByTestId('location-sheet-chosen-toronto')).toBeVisible();

        // Committing without changing anything must not narrow the filter.
        await page.getByTestId('location-sheet-continue').click();
        await expect(page).toHaveURL(/country=Canada%2CToronto/);
    });
});
