import { test, expect } from '@playwright/test';
import { chromium, webkit } from 'playwright';

/**
 * TEST GROUP: JOBS-ROW-SOURCE-PILLS - the /jobs row's "New" mark.
 *
 * "New" shows once, only on a newly listed role (the row's own freshness rule), and sits inside its row's
 * box. Rendered from the /mock/job-row-source fixture (a fixed clock, one row per case), in Chromium AND
 * WebKit (the phone engine) at 1440 and 390. The repo config registers only a chromium project, so each
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
        test(`${name} ${viewport.width}: the New mark shows once, on a new role only, inside its row`, { tag: ['@J-JOBS-164'] }, async ({ baseURL }) => {
            test.skip(!/localhost|127\.0\.0\.1/.test(baseURL ?? ''), '/mock/* is a design fixture, not served on production');
            const browser = await engine.launch();
            try {
                const page = await browser.newPage({ viewport });
                await page.goto(new URL('/mock/job-row-source', baseURL).toString());
                const row = (id: string) => page.locator(`[data-job-id="${id}"]`);
                await expect(row('new')).toBeVisible({ timeout: 30_000 });

                const newMark = (id: string) => row(id).getByTestId('freshness-badge');
                await expect(newMark('new')).toHaveText('New');
                await expect(newMark('new')).toHaveCount(1);
                await expect(row('new').getByText('New', { exact: true })).toHaveCount(1);
                await expect(newMark('old')).toHaveCount(0);
                await expect(newMark('relisted')).toHaveCount(0);
                await expect(page.getByText(/Seen by/)).toHaveCount(0);

                // The mark's box sits inside its row's box.
                const rowBox = await row('new').boundingBox();
                const markBox = await newMark('new').boundingBox();
                expect(rowBox && markBox).toBeTruthy();
                expect(markBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
                expect(markBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
                expect(markBox!.x + markBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
                expect(markBox!.y + markBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height);

                // Facts only: no claim about any other site; the page does not scroll sideways.
                await expect(page.getByText(/google|linkedin/i)).toHaveCount(0);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

                if (OUT) await page.screenshot({ path: `${OUT}/${name}-${viewport.width}.png`, fullPage: true });
            } finally {
                await browser.close();
            }
        });
    }
}
