import { test, expect } from '@playwright/test';
import { chromium, webkit } from 'playwright';

/**
 * TEST GROUP: JOBS-ROW-SOURCE-PILLS - the /jobs row's two fact chips.
 *
 * "Seen by Velai {age}" shows only on a newly listed role (the row's own "New" rule); "From the company's
 * site" shows only on a role the pipeline read from the employer's own careers page / ATS (`*_direct`
 * source). Rendered from the /mock/job-row-source fixture (a fixed clock, one row per case), in Chromium
 * AND WebKit (the phone engine) at 1440 and 390. The repo config registers only a chromium project, so each
 * case launches its own browser, as scripts/gate-walk-signed-in.mjs does.
 */
const OUT = process.env.SOURCE_PILLS_SHOTS; // optional directory for screenshots
const ENGINES = [
    ['chromium', chromium],
    ['webkit', webkit],
] as const;
const VIEWPORTS = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
];

for (const [name, engine] of ENGINES) {
    for (const viewport of VIEWPORTS) {
        test(`${name} ${viewport.width}: source pills show only where the row's facts make them true`, { tag: ['@J-JOBS-163'] }, async ({ baseURL }) => {
            test.skip(!/localhost|127\.0\.0\.1/.test(baseURL ?? ''), '/mock/* is a design fixture, not served on production');
            const browser = await engine.launch();
            try {
                const page = await browser.newPage({ viewport });
                await page.goto(new URL('/mock/job-row-source', baseURL).toString());
                const row = (id: string) => page.locator(`[data-job-id="${id}"]`);
                await expect(row('new-employer')).toBeVisible({ timeout: 30_000 });

                await expect(row('new-employer').getByTestId('first-seen-pill')).toHaveText("Seen by Velai1d ago");
                await expect(row('new-employer').getByTestId('employer-site-pill')).toHaveText("From the company's site");
                await expect(row('new-board').getByTestId('first-seen-pill')).toBeVisible();
                await expect(row('new-board').getByTestId('employer-site-pill')).toHaveCount(0);
                await expect(row('old-employer').getByTestId('employer-site-pill')).toBeVisible();
                await expect(row('old-employer').getByTestId('first-seen-pill')).toHaveCount(0);
                await expect(row('old-board').getByTestId('first-seen-pill')).toHaveCount(0);
                await expect(row('old-board').getByTestId('employer-site-pill')).toHaveCount(0);
                await expect(row('new-unknown-source').getByTestId('first-seen-pill')).toBeVisible();
                await expect(row('new-unknown-source').getByTestId('employer-site-pill')).toHaveCount(0);

                // Facts only: no claim about any other site; the page does not scroll sideways.
                await expect(page.locator('[data-testid$="-pill"]').filter({ hasText: /google|linkedin/i })).toHaveCount(0);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

                if (OUT) await page.screenshot({ path: `${OUT}/${name}-${viewport.width}.png`, fullPage: true });
            } finally {
                await browser.close();
            }
        });
    }
}
