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
        test(`${name} ${viewport.width}: row marks show only where the row's facts make them true`, { tag: ['@J-JOBS-163'] }, async ({ baseURL }) => {
            test.skip(!/localhost|127\.0\.0\.1/.test(baseURL ?? ''), '/mock/* is a design fixture, not served on production');
            const browser = await engine.launch();
            try {
                const page = await browser.newPage({ viewport });
                await page.goto(new URL('/mock/job-row-source', baseURL).toString());
                const row = (id: string) => page.locator(`[data-job-id="${id}"]`);
                await expect(row('new-employer')).toBeVisible({ timeout: 30_000 });

                const newMark = (id: string) => row(id).getByTestId('freshness-badge');
                const site = (id: string) => row(id).getByTestId('employer-site-pill');
                await expect(newMark('new-employer')).toHaveText('New');
                await expect(newMark('new-employer')).toHaveCount(1);
                await expect(row('new-employer').getByText('New', { exact: true })).toHaveCount(1);
                await expect(site('new-employer')).toHaveText("From the company's site");
                await expect(newMark('new-board')).toHaveCount(1);
                await expect(site('new-board')).toHaveCount(0);
                await expect(site('old-employer')).toBeVisible();
                await expect(newMark('old-employer')).toHaveCount(0);
                await expect(newMark('old-board')).toHaveCount(0);
                await expect(site('old-board')).toHaveCount(0);
                await expect(newMark('new-unknown-source')).toHaveCount(1);
                await expect(site('new-unknown-source')).toHaveCount(0);
                await expect(page.getByText(/Seen by/)).toHaveCount(0);

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
