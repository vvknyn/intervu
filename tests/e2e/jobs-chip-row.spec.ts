import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-CHIP-ROW. Every applied-chip row (CHIP_SCROLL_ROW) is one
 * line at every width, and a coarse-pointer control inside it keeps its 44px
 * hit area: the scroller's clip box must not cut the ::before expander.
 * Search is stubbed, so no backend is needed.
 */
const hit = { id: 'r1', title: 'Product Manager', company: 'Co', company_domain: null, location: 'Remote', work_type: 'remote', employment_type: 'full_time', experience_level: 'mid', tags: [], apply_url: 'https://example.com', source: 'e2e', posted_at: new Date().toISOString(), vacancy_status: 'open' };
const URL_MANY = '/jobs?q=product+manager&work=remote&exp=senior&posted=7d&visa=1&salary=100k&years=3-5&ghosts=show&country=Canada&city=Toronto';

async function open(page: Page) {
    await page.addInitScript(() => localStorage.setItem('velai.onboarding.completed', '1'));
    await page.route('**/api/jobs/search', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [hit], total: 1, backend: 'meilisearch', configured: true, searchId: 'c' }) }).catch(() => {}));
    await page.goto(URL_MANY);
    await page.getByTestId('job-row').first().waitFor({ timeout: 60_000 });
}

/** The row holding the Filters pill: the docked TopBar row at lg+, jobs-toolbar-rows below. */
const scrollerOf = (page: Page) => page.locator('[data-testid="topbar-docked-filters-toggle"], [data-testid="filters-toggle"]').locator('visible=true').first().locator('xpath=ancestor::*[contains(@class,"overflow-x-auto")][1]');

for (const width of [1440, 1024, 390]) {
    test(`chip row is one scrolling line at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page);
        const tops = await page.locator('[data-testid="topbar-docked-chip"], [data-testid="active-filter-chip"]').evaluateAll((els) =>
            els.filter((e) => (e as HTMLElement).offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(tops.length).toBeGreaterThan(5);
        expect(new Set(tops).size, 'all chips share one line').toBe(1);
        const row = scrollerOf(page);
        expect(await row.evaluate((e) => getComputedStyle(e).flexWrap)).toBe('nowrap');
        expect(await row.evaluate((e) => getComputedStyle(e).maskImage)).not.toBe('none');
    });
}

test.describe('coarse pointer', () => {
    test.use({ hasTouch: true, isMobile: true });
    for (const width of [1024, 390]) {
        test(`controls inside the chip scroller (Filters, Clear, chip x) keep a 44px effective hit height at ${width}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await open(page);
            // Filters pill, Clear (end of the row, scrolled in) and a chip's x: all live in the scroller.
            for (const sel of [
                '[data-testid="topbar-docked-filters-toggle"], [data-testid="filters-toggle"]',
                '[data-testid="results-clear-filters"]',
                '[data-testid="topbar-docked-chip"] button, [data-testid="active-filter-chip"] button',
            ]) {
                const el = page.locator(sel).locator('visible=true').first();
                await el.evaluate((e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
                const box = (await el.boundingBox())!;
                if (!sel.includes('chip')) expect(Math.round(box.height), `${sel}: the row still renders 32px tall`).toBeLessThanOrEqual(36);
                // Probe 5px beyond the box (top and bottom) inside the 44px hit area.
                const edge = await el.evaluate((n) => {
                    const r = n.getBoundingClientRect();
                    const at = (y: number) => { const t = document.elementFromPoint(r.x + r.width / 2, y); return !!t && (t === n || n.contains(t)); };
                    return { above: at(r.y - 5), below: at(r.y + r.height + 5) };
                });
                expect(edge, `${sel}: hit area reaches 5px past the box on both sides`).toEqual({ above: true, below: true });
            }
        });
    }
});
