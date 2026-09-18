import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: NO-HORIZONTAL-OVERFLOW - /jobs never scrolls sideways on a
 * phone
 *
 * Regression: the toolbar chip row (Filters / All filters / Posted · Past
 * month / Sort) sat inside a flex-column section carrying `mx-auto` with no
 * explicit width. An auto margin on a flex item's cross axis suppresses
 * `align-items: stretch` (CSS Flexbox spec), so the section shrank to fit
 * its own content instead of the viewport — once the real chip set (not the
 * sparse "not connected" fallback) was wide enough, the whole document grew
 * past the viewport and every page scrolled sideways at 360/390px.
 *
 * This is a CLASS check, not a re-run of the one instance that surfaced the
 * bug: it walks both the pristine landing (`atRest`, the branch that broke)
 * and the live-query results view (the branch that never used `mx-auto`),
 * plus results with a job open (a bottom Sheet mounts new, unrelated DOM),
 * at both widths named in the report (360 and 390) — six surfaces total, so
 * a fix scoped to only the one reported (390, landing) would still be
 * caught here on any of the other five.
 *
 * Two kinds of element legitimately sit past the viewport edge and must be
 * excluded from the per-element offender scan, or it false-positives on
 * working UI: fixed-position elements (bottom Search CTA, mobile tab bar,
 * toast container) are full-bleed by design, and anything past the fold of
 * a horizontally-scrollable ancestor (e.g. content scrolled out of view in
 * the toolbar's chip rail — that rail existing at all is this bug's fix) is
 * contained there, not leaking into document scrollWidth. Neither affects
 * `document.documentElement.scrollWidth`, which only grows when something
 * actually pushes layout wider — the authoritative check below — so the
 * offender scan excludes both explicitly, and only ever names the actual
 * cause when that check fails.
 */

const WIDTHS = [360, 390] as const;
const RESULTS_QUERY = '/jobs?q=product+designer';

/** Environment-tolerant settle: the board is a client-rendered island, and
 *  the corpus may be real (prod), empty, or entirely disconnected (a local
 *  render with no backend secrets — see the "not connected" fallback in
 *  page.tsx). Every branch renders one of these, so waiting for any of them
 *  means the DOM has actually settled rather than still showing a spinner —
 *  same shape as jobs-first-screen.spec.ts's warm-up wait. The pristine
 *  landing (`atRest`, no query yet) never renders job rows or those status
 *  strings at all — it renders the browse-by-field ask instead — so it also
 *  needs `serp-ask-seed`, the same testid jobs-first-screen.spec.ts settles
 *  on for that surface (present on both the compact pivot row above real
 *  results and the full ask fallback, so it holds regardless of which
 *  branch this environment's search reachability lands on). */
async function waitForJobsSettled(page: Page) {
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

/**
 * Assert the document never scrolls sideways, and name every non-fixed
 * offender (tag + class) when it does — a bare width number tells you a
 * page is broken but not which element to go fix.
 */
async function expectNoHorizontalOverflow(page: Page, where: string) {
    const report = await page.evaluate(() => {
        const innerWidth = window.innerWidth;
        // An element whose overflow is contained by a horizontally-scrollable
        // ancestor (overflow-x: auto/scroll) — e.g. content past the fold of
        // the toolbar's chip rail — cannot widen the document; that's the
        // whole point of the rail. Only elements NOT contained by one can
        // actually push document.documentElement.scrollWidth, so a real
        // offender must have no such ancestor between it and <body>.
        const isScrollContained = (el: Element) => {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                const overflowX = getComputedStyle(a).overflowX;
                if (overflowX === 'auto' || overflowX === 'scroll') return true;
            }
            return false;
        };
        const offenders = [...document.querySelectorAll('body *')]
            .filter((el) => getComputedStyle(el).position !== 'fixed')
            .filter((el) => !isScrollContained(el))
            .map((el) => ({ el, box: el.getBoundingClientRect() }))
            .filter(({ box }) => box.width > 0 && box.right > innerWidth + 1)
            .sort((a, b) => b.box.right - a.box.right)
            .slice(0, 5)
            .map(({ el, box }) => ({
                tag: el.tagName.toLowerCase(),
                cls: (el.className?.toString?.() || '').slice(0, 100),
                right: Math.round(box.right),
                width: Math.round(box.width),
            }));
        return {
            innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            offenders,
        };
    });

    const offenderList = report.offenders
        .map((o) => `  <${o.tag} class="${o.cls}"> right=${o.right} width=${o.width}`)
        .join('\n');

    expect(
        report.scrollWidth,
        `${where}: document.documentElement.scrollWidth (${report.scrollWidth}) exceeds ` +
            `window.innerWidth (${report.innerWidth}) at ${report.innerWidth}px. Offenders:\n${offenderList}`,
    ).toBeLessThanOrEqual(report.innerWidth);

    expect(
        report.offenders,
        `${where}: ${report.offenders.length} non-fixed element(s) extend past the ` +
            `${report.innerWidth}px viewport:\n${offenderList}`,
    ).toHaveLength(0);
}

for (const width of WIDTHS) {
    test.describe(`NO-HORIZONTAL-OVERFLOW at ${width}px`, () => {
        test.use({ viewport: { width, height: 844 } });

        test(`landing /jobs does not scroll sideways at ${width}px`, async ({ page }) => {
            await page.goto('/jobs');
            await waitForJobsSettled(page);
            await expectNoHorizontalOverflow(page, `/jobs landing @ ${width}px`);
        });

        test(`results ${RESULTS_QUERY} does not scroll sideways at ${width}px`, async ({ page }) => {
            await page.goto(RESULTS_QUERY);
            await waitForJobsSettled(page);
            await expectNoHorizontalOverflow(page, `results @ ${width}px`);
        });

        test(`results with first row opened does not scroll sideways at ${width}px`, async ({ page }) => {
            await page.goto(RESULTS_QUERY);
            await waitForJobsSettled(page);
            const rows = page.getByTestId('job-row');
            if ((await rows.count()) === 0) {
                test.skip(true, 'No job rows in this environment (empty or not-connected fallback)');
            }
            await rows.first().click();
            await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
            await expectNoHorizontalOverflow(page, `results with row opened @ ${width}px`);
        });
    });
}
