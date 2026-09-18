import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: MOBILE-LIST-INSET-TOOLBAR — /jobs mobile layout audit fixes
 * (2026-09-18): one shared list inset, a toolbar edge fade that only shows
 * where content is actually clipped, and a search dock whose corners match
 * its row count.
 *
 * Every assertion here runs at more than just the 390px the audit was taken
 * at — a fix that only proves itself at the one width that surfaced the bug
 * is rejected by this repo's generic-fix rule.
 *
 * The list-inset check (fix 1) runs at 390/360/1440: that fix is a single
 * CSS custom property with no breakpoint of its own, so it must hold at a
 * true desktop width too.
 *
 * The toolbar-fade and dock-corner checks (fixes 2 and 4) run at
 * 390/360/800, NOT 1440. Both surfaces are mobile/tablet-only by an
 * existing, unrelated product rule: `headerDockActive` (page.tsx,
 * `isLgUp && showSearchHome && !atRest`) swaps the entire search dock and
 * toolbar row for a different desktop header search once the viewport
 * clears `lg` (1024px) with a query active, so `jobs-search-dock` and
 * `jobs-toolbar-scroller` are legitimately absent from the DOM at 1440 —
 * asserting against them there would be testing a surface the page never
 * renders, not proving the fix. 800px sits inside `sm..lg` (640-1024): the
 * dock is in its pill shape and the toolbar has room to NOT overflow, so it
 * is what actually proves "no fade when nothing overflows" (360 always
 * overflows) and "pill from sm" generically, without colliding with the
 * unrelated desktop swap.
 */

const RESULTS_QUERY = '/jobs?q=product+designer';
const WIDTHS = [390, 360, 1440] as const;
const MOBILE_TOOLBAR_WIDTHS = [390, 360, 800] as const;

async function waitForResultsSettled(page: Page) {
    await page.waitForLoadState('networkidle');
    await page
        .getByTestId('job-row')
        .first()
        .or(page.getByTestId('serp-ask-seed').first())
        .or(page.getByText(/being connected/i))
        .or(page.getByText(/No roles match/i))
        .or(page.getByText(/temporarily unavailable/i))
        .waitFor({ state: 'visible', timeout: 15_000 });
}

for (const width of WIDTHS) {
    test.describe(`MOBILE-LIST-INSET-TOOLBAR at ${width}px`, () => {
        test.use({ viewport: { width, height: width === 1440 ? 900 : 844 } });

        test(`results header left edge matches JobRow content left edge at ${width}px`, async ({ page }) => {
            await page.goto(RESULTS_QUERY);
            await waitForResultsSettled(page);

            const jobRow = page.getByTestId('job-row').first();
            const resultLine = page.getByTestId('result-line').first();
            await expect(jobRow).toBeVisible();
            await expect(resultLine).toBeVisible();

            const rowContentLeft = await jobRow.evaluate((el) => {
                const box = el.getBoundingClientRect();
                const paddingLeft = parseFloat(getComputedStyle(el).paddingLeft || '0');
                return box.left + paddingLeft;
            });
            const headerTextLeft = await resultLine.evaluate((el) => el.getBoundingClientRect().left);

            expect(
                Math.abs(rowContentLeft - headerTextLeft),
                `at ${width}px: JobRow content starts at ${rowContentLeft}, header text ("result-line") ` +
                    `starts at ${headerTextLeft} — they must share one inset (--list-inset), not two`,
            ).toBeLessThanOrEqual(1);
        });
    });
}

for (const width of MOBILE_TOOLBAR_WIDTHS) {
    test.describe(`MOBILE-LIST-INSET-TOOLBAR toolbar/dock at ${width}px`, () => {
        test.use({ viewport: { width, height: 844 } });

        test(`toolbar shows a right edge fade iff its content actually overflows at ${width}px`, async ({ page }) => {
            await page.goto(RESULTS_QUERY);
            await waitForResultsSettled(page);

            const scroller = page.getByTestId('jobs-toolbar-scroller');
            await expect(scroller).toBeVisible();

            const { overflows, fadeRight } = await scroller.evaluate((el) => ({
                overflows: el.scrollWidth > el.clientWidth + 1,
                fadeRight: el.getAttribute('data-fade-right') === 'true',
            }));

            expect(
                fadeRight,
                `at ${width}px: toolbar scrollWidth/clientWidth overflow=${overflows} but ` +
                    `data-fade-right=${fadeRight} — the fade must appear exactly when content is clipped`,
            ).toBe(overflows);
        });

        test(`search dock corners are 16px below sm, pill from sm up, at ${width}px`, async ({ page }) => {
            await page.goto(RESULTS_QUERY);
            await waitForResultsSettled(page);

            const dock = page.getByTestId('jobs-search-dock');
            await expect(dock).toBeVisible();

            const { radius, height, isStackedBelowSm } = await dock.evaluate((el) => {
                const box = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return {
                    radius: parseFloat(style.borderTopLeftRadius || '0'),
                    height: box.height,
                    // Below `sm` the dock stacks two rows (query + location),
                    // so it is visibly taller than a single ~44-56px control
                    // row — read the actual layout rather than hardcoding the
                    // 640px breakpoint a second time in the test.
                    isStackedBelowSm: box.height > 80,
                };
            });

            if (isStackedBelowSm) {
                expect(
                    radius,
                    `at ${width}px: stacked dock (height ${height}) has border-radius ${radius}px, expected 16px (rounded-panel)`,
                ).toBeCloseTo(16, 0);
            } else {
                const expectedPill = height / 2;
                expect(
                    radius,
                    `at ${width}px: single-row dock (height ${height}) has border-radius ${radius}px, ` +
                        `expected a full pill (~${expectedPill}px)`,
                ).toBeGreaterThanOrEqual(expectedPill - 1);
            }
        });
    });
}
