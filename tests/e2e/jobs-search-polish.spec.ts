import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SEARCH - /jobs search polish (sort, panes, selection)
 *
 * Environment-tolerant: works with configured Meilisearch OR unconfigured backend.
 * Seeds BROWSE mode via localStorage to skip the entry gate.
 */

const ENTRY_KEY = 'intervu.jobs.entry';

async function enterBrowseMode(page: Page) {
    await page.addInitScript((key) => {
        try {
            window.localStorage.setItem(key, JSON.stringify({ mode: 'browse', q: '' }));
        } catch {
            /* storage disabled */
        }
    }, ENTRY_KEY);
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');
    // Gate must be gone
    await expect(
        page.getByRole('heading', { name: /Tailor jobs to your resume/i }),
    ).toHaveCount(0, { timeout: 15000 });
}

test.describe('JOBS-SEARCH - sort, selection, and pane geometry', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key);
                window.localStorage.clear();
            } catch {
                /* ignore */
            }
        }, ENTRY_KEY);
    });

    test('TC-JOBS-SORT-001: sort control offers three labeled options when configured', async ({ page }) => {
        await enterBrowseMode(page);

        const sortTrigger = page.getByRole('combobox', { name: /Sort results/i });
        const configured = (await sortTrigger.count()) > 0;

        if (!configured) {
            const empty = page
                .locator('text=/being connected/i')
                .or(page.locator('text=/Finding live roles/i'))
                .first();
            await expect(empty).toBeVisible({ timeout: 15000 });
            return;
        }

        await sortTrigger.click();
        await expect(page.getByRole('option', { name: 'Date posted' })).toBeVisible();
        await expect(page.getByRole('option', { name: 'Salary high to low' })).toBeVisible();
        const bestMatch = page.getByRole('option', { name: 'Best match' });
        await expect(bestMatch).toBeVisible();
        await expect(bestMatch).toBeDisabled();

        await page.getByRole('option', { name: 'Salary high to low' }).click();
        await expect(page.locator('text=/highest salary first/i').first()).toBeVisible({ timeout: 15000 });
    });

    test('TC-JOBS-SORT-002: clearing query resets relevance sort to date posted', async ({ page }) => {
        await enterBrowseMode(page);

        const sortTrigger = page.getByRole('combobox', { name: /Sort results/i });
        if ((await sortTrigger.count()) === 0) {
            test.skip(true, 'Backend unconfigured — sort control absent');
        }

        const searchInput = page.getByPlaceholder(/Search role/i);
        await searchInput.fill('engineer');
        await expect(sortTrigger).toBeVisible({ timeout: 15000 });

        await sortTrigger.click();
        await page.getByRole('option', { name: 'Best match' }).click();
        await expect(sortTrigger).toContainText(/Best match/i);

        await searchInput.fill('');
        await expect(sortTrigger).toContainText(/Date posted/i, { timeout: 15000 });
    });

    test('TC-JOBS-SEL-001: row click sets aria-selected and syncs desktop detail', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const rows = page.locator('[data-job-row]');
        if ((await rows.count()) === 0) {
            const empty = page
                .locator('text=/being connected|No roles match|Finding live roles/i')
                .first();
            await expect(empty).toBeVisible({ timeout: 15000 });
            return;
        }

        const second = rows.nth(1);
        await second.click();
        await expect(second).toHaveAttribute('aria-selected', 'true');

        const title = await second.locator('.font-semibold').first().textContent();
        if (title) {
            await expect(page.getByRole('heading', { level: 2, name: new RegExp(title.trim().slice(0, 20), 'i') })).toBeVisible();
        }
    });

    test('TC-JOBS-LAYOUT-001: desktop panes scroll independently within bounded viewport', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const rows = page.locator('[data-job-row]');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No job rows — cannot verify pane scroll geometry');
        }

        const metrics = await page.evaluate(() => {
            const list = document.getElementById('jobs-results-list');
            const panes = document.querySelectorAll('.overscroll-contain.custom-scrollbar');
            const bounded = document.querySelector('.lg\\:h-\\[calc\\(100dvh-4rem\\)\\]');
            const paneData = [...panes].map((el) => {
                const node = el as HTMLElement;
                const style = getComputedStyle(node);
                return {
                    overflowY: style.overflowY,
                    clientHeight: node.clientHeight,
                    scrollHeight: node.scrollHeight,
                    canScroll: node.scrollHeight > node.clientHeight,
                };
            });
            return {
                boundedHeight: bounded ? (bounded as HTMLElement).clientHeight : 0,
                listOverflow: list ? getComputedStyle(list).overflowY : null,
                listClientHeight: list?.clientHeight ?? 0,
                pageScrollHeight: document.documentElement.scrollHeight,
                viewportHeight: window.innerHeight,
                paneCount: paneData.length,
                scrollablePanes: paneData.filter((p) => p.overflowY === 'auto' || p.overflowY === 'scroll').length,
                paneData,
            };
        });

        expect(metrics.boundedHeight).toBeGreaterThan(0);
        expect(metrics.boundedHeight).toBeLessThanOrEqual(metrics.viewportHeight);
        expect(metrics.listOverflow).toBe('auto');
        expect(metrics.scrollablePanes).toBeGreaterThanOrEqual(2);
        // Bounded workspace: page should not grow to multi-thousand px document scroll on desktop.
        expect(metrics.pageScrollHeight).toBeLessThan(metrics.viewportHeight * 2);
    });

    test('TC-JOBS-MOBILE-001: deliberate row tap opens bottom sheet detail', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await enterBrowseMode(page);

        const rows = page.locator('[data-job-row]');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No job rows for mobile sheet test');
        }

        await rows.first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog.getByRole('heading', { level: 2 }).first()).toBeVisible();
    });
});
