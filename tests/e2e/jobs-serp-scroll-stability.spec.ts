import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SERP-SCROLL - the SERP survives being scrolled
 *
 * Regression gate for the 2026-08-24 prod incident: scrolling /jobs far enough
 * to push the search box out of view dropped the whole page into its error
 * boundary with React #185 ("Maximum update depth exceeded").
 *
 * Cause: the docked-search effect depended on `filterState`, an object literal
 * rebuilt every render, while its own body called `setDocked(...)` on a
 * provider above the page — so the effect re-ran on its own output forever. It
 * stayed invisible until `searchOutOfView` turned true, because until then the
 * effect returned early at an idempotent `setDocked(null)`. Scrolling did not
 * cause the loop; it satisfied the last condition the loop needed.
 *
 * `tests/unit/jobs-effect-dep-stability.test.ts` guards the CAUSE statically
 * and cheaply across every effect in the page. This spec guards the SYMPTOM the
 * person actually reported, through a real browser, and so also covers render
 * loops that arrive by some route the static scanner cannot see.
 *
 * Structural, not text-based (same rule as jobs-first-screen.spec.ts): the
 * boundary is matched on `error-boundary`, not on "Something went sideways",
 * so rewording the copy cannot quietly disarm this gate.
 *
 * Environment-tolerant: it asserts the page did not CRASH, never that any
 * particular row rendered, so it holds whether or not Meilisearch is reachable
 * from the machine running it.
 */

const SERP = '/jobs?q=engineer&posted=any';

/** React's "Maximum update depth exceeded" — minified (#185) and un-minified. */
const RENDER_LOOP = /Minified React error #185|Maximum update depth exceeded/;

test.describe('JOBS-SERP-SCROLL', () => {
    test('TC-SERP-SCROLL-001: scrolling the SERP past the search box does not crash the page', async ({ page }) => {
        const loopErrors: string[] = [];
        page.on('pageerror', (err) => {
            if (RENDER_LOOP.test(err.message)) loopErrors.push(err.message);
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error' && RENDER_LOOP.test(msg.text())) loopErrors.push(msg.text());
        });

        await page.goto(SERP);
        await page.waitForLoadState('domcontentloaded');

        // Scroll in steps, not one jump: the loop needs a render pass after
        // `searchOutOfView` flips, and a single instant jump to the bottom can
        // land before the observer has fired at all.
        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 900);
            await page.waitForTimeout(400);
        }

        expect(
            loopErrors,
            'the SERP entered an infinite render loop while scrolling',
        ).toEqual([]);
        await expect(page.getByTestId('error-boundary')).toHaveCount(0);
    });

    test('TC-SERP-SCROLL-002: the same holds with places filtered — the dock renders a place', async ({ page }) => {
        // A case OTHER than the one that surfaced the bug: the crash was found
        // with no location filter at all, where the docked place is `undefined`.
        // Multiple places is the branch that actually makes the dock label
        // change ("Toronto +1"), so it exercises the dependency this effect
        // reads rather than only the empty path through it.
        const loopErrors: string[] = [];
        page.on('pageerror', (err) => {
            if (RENDER_LOOP.test(err.message)) loopErrors.push(err.message);
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error' && RENDER_LOOP.test(msg.text())) loopErrors.push(msg.text());
        });

        await page.goto('/jobs?q=engineer&posted=any&country=toronto,montreal');
        await page.waitForLoadState('domcontentloaded');

        for (let i = 0; i < 6; i++) {
            await page.mouse.wheel(0, 900);
            await page.waitForTimeout(400);
        }

        expect(
            loopErrors,
            'the SERP entered an infinite render loop while scrolling with places filtered',
        ).toEqual([]);
        await expect(page.getByTestId('error-boundary')).toHaveCount(0);
    });
});
