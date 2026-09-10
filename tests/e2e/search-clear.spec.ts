import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: SEARCH-CLEAR — the jobs search box's "X" clear button
 *
 * Root cause: `SearchAutocomplete`'s `<Input>` carried `z-20` while the jobs
 * page rendered the "X" clear button as an absolutely-positioned SIBLING at
 * `z-10`, both inside the same non-isolated stacking context — 20 beats 10,
 * so the visually-transparent Input intercepted every tap meant for the
 * button underneath it. Fixed by having `SearchAutocomplete` own the
 * affordance itself (the `onClear` prop), rendered inside its own wrapper
 * at `z-30`, strictly above the Input's `z-20` (which is unchanged).
 *
 * Two query fields exist on /jobs, gated on the SAME `headerDockActive =
 * isLgUp` flag in jobs/page.tsx — never both mounted at once:
 *  - below `lg` (this spec's mobile case): the always-on in-page row,
 *    `[data-tour="jobs-search"]`. This is where the bug was reported and
 *    reproduced.
 *  - at `lg`+ (this spec's desktop case): the header's docked field,
 *    `[data-testid="topbar-docked-search"]`. Not part of the report (it
 *    already had a working, non-overlapping clear button), but it now
 *    routes through the same `onClear` prop on the same component, so
 *    covering it here proves the fix is the shared component's contract,
 *    not a patch aimed only at the one call site that was reported.
 */

const CASES: Array<{
    name: string;
    viewport: { width: number; height: number };
    isMobile: boolean;
    hasTouch: boolean;
    userAgent?: string;
    fieldSelector: string;
}> = [
    {
        name: 'mobile',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        fieldSelector: '[data-tour="jobs-search"] input',
    },
    {
        name: 'desktop',
        viewport: { width: 1280, height: 800 },
        isMobile: false,
        hasTouch: false,
        fieldSelector: '[data-testid="topbar-docked-search"] input',
    },
];

for (const { name, viewport, isMobile, hasTouch, userAgent, fieldSelector } of CASES) {
    test.describe(`SEARCH-CLEAR (${name})`, () => {
        test.use({
            viewport,
            isMobile,
            hasTouch,
            ...(userAgent ? { userAgent } : {}),
        });

        test(`${name}: the clear button sits above the input and actually clears it`, async ({ page }) => {
            await page.goto('/jobs?posted=any');
            await page.waitForLoadState('domcontentloaded');

            const input = page.locator(fieldSelector).first();
            await input.waitFor({ state: 'visible', timeout: 30_000 });
            await input.fill('engineer');
            await expect(input).toHaveValue('engineer');

            const clearButton = page.getByTestId('search-input-clear');
            await expect(clearButton).toBeVisible();

            // The actual bug: `elementFromPoint` at the button's own center
            // resolving to the (visually transparent) Input on top of it
            // instead of the button — a stacking defect a plain visibility
            // check does not catch.
            const box = await clearButton.boundingBox();
            if (!box) throw new Error('clear button has no bounding box');
            const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            const hitTestId = await page.evaluate(
                ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
                point,
            );
            expect(
                hitTestId,
                `elementFromPoint(${point.x}, ${point.y}) must resolve to the clear button, not the input underneath it`,
            ).toBe('search-input-clear');

            await clearButton.click();
            await expect(input).toHaveValue('');
        });
    });
}
