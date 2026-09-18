import { test, expect, type Locator } from '@playwright/test';
import { SEARCH_PLACEHOLDER } from '../../src/lib/jobs/search-copy';

/**
 * TEST GROUP: SEARCH-PLACEHOLDER-FITS - the /jobs query field never clips
 * its own placeholder
 *
 * Regression (2026-09-17, prod at 1440): the pill hosting the query field
 * (`data-tour="jobs-search"` in src/app/jobs/page.tsx) sits inside a flex
 * column whose `mx-auto` suppresses `align-items: stretch` — the exact
 * mechanism documented in no-horizontal-overflow.spec.ts's header comment —
 * so the row shrink-wrapped to its own content instead of the section's
 * `max-w-7xl`. `sm:flex-1` (flex-basis: 0%) contributes nothing to that
 * shrink-to-fit measurement, so the pill only ever got as wide as its own
 * content needed: 415px measured on prod, leaving the query `<input>` 148px
 * of padding-exclusive room for a placeholder that renders at 176px —
 * `SEARCH_PLACEHOLDER` clipped.
 *
 * This is a CLASS check, not a re-run of the one instance that surfaced the
 * bug: it measures the ACTUAL rendered placeholder text against the
 * input's actual usable width (via canvas `measureText` on the input's own
 * computed font, so it tracks whatever copy `SEARCH_PLACEHOLDER` holds
 * rather than a hard-coded string), at three viewports spanning the
 * responsive range this pill renders at — 390 (mobile, unaffected by the
 * lg-only width fix), 1024 (the `lg` breakpoint itself), and 1440 (the
 * viewport the bug was measured at) — so a fix scoped to only 1440 would
 * still be caught here at 1024.
 */

const VIEWPORTS = [390, 1024, 1440] as const;

/** `atRest` (page.tsx) starts false and flips true once a mount effect
 *  confirms scroll position — until it does, the search section briefly
 *  wears the mid-search panel's classes (no `max-w` at all) instead of the
 *  landing hero's, so the pill's width is a moving target for a moment
 *  after first paint. Polling for two consecutive equal readings (rather
 *  than a fixed sleep) waits out exactly that flash without hard-coding a
 *  duration, the same way `no-horizontal-overflow.spec.ts` polls for a
 *  settled results surface instead of guessing a timeout. */
async function waitForStableWidth(locator: Locator, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previous: number | null = null;
    while (Date.now() < deadline) {
        const box = await locator.boundingBox();
        const width = box?.width ?? null;
        if (width !== null && width === previous) return;
        previous = width;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

test.describe('search placeholder fits its input', () => {
    for (const width of VIEWPORTS) {
        test(`placeholder does not exceed the query input's usable width at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/jobs');
            await page.waitForLoadState('networkidle');

            const input = page.getByPlaceholder(SEARCH_PLACEHOLDER);
            await input.waitFor({ state: 'visible', timeout: 15_000 });
            await waitForStableWidth(input);

            const measurement = await input.evaluate((el: HTMLInputElement, placeholder: string) => {
                const style = getComputedStyle(el);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d')!;
                ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const textWidth = ctx.measureText(placeholder).width;
                const usableWidth =
                    el.clientWidth -
                    parseFloat(style.paddingLeft || '0') -
                    parseFloat(style.paddingRight || '0');
                return { textWidth, usableWidth, clientWidth: el.clientWidth };
            }, SEARCH_PLACEHOLDER);

            expect(
                measurement.textWidth,
                `at ${width}px: placeholder "${SEARCH_PLACEHOLDER}" measures ${measurement.textWidth.toFixed(1)}px ` +
                    `but the input's usable width is only ${measurement.usableWidth.toFixed(1)}px ` +
                    `(clientWidth ${measurement.clientWidth}px minus horizontal padding)`,
            ).toBeLessThanOrEqual(measurement.usableWidth);
        });
    }
});
