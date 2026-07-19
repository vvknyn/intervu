import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SEARCH - /jobs search polish (sort, panes, selection)
 *
 * Environment-tolerant: works with configured Meilisearch OR unconfigured backend.
 * There is no entry gate — /jobs renders BROWSE results on first paint for
 * everyone (see jobs-first-screen.spec.ts) — so this just navigates straight in.
 */

async function enterBrowseMode(page: Page) {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');
    await expect(
        page.getByRole('listbox', { name: 'Job results' })
            .or(page.getByText(/Job search is being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/Job search is temporarily unavailable/i))
            .first(),
    ).toBeVisible({ timeout: 15000 });
}

test.describe('JOBS-SEARCH - sort, selection, and pane geometry', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* ignore */
            }
        });
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

        const searchInput = page.getByPlaceholder(/live-checked roles/i);
        await searchInput.fill('engineer');
        await expect(sortTrigger).toBeVisible({ timeout: 15000 });

        await sortTrigger.click();
        await page.getByRole('option', { name: 'Best match' }).click();
        await expect(sortTrigger).toContainText(/Best match/i);

        await searchInput.fill('');
        await expect(sortTrigger).toContainText(/Date posted/i, { timeout: 15000 });
    });

    test('TC-JOBS-REFRESH-001: refetch keeps current results visible and shows in-flight feedback', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        const firstResult = results.getByRole('option').first();
        if ((await firstResult.count()) === 0) {
            test.skip(true, 'No job rows — cannot verify background refresh feedback');
        }

        await page.getByPlaceholder(/live-checked roles/i).fill('engineer');
        await expect(page.getByText('Updating…', { exact: true })).toBeVisible({ timeout: 2000 });
        await expect(firstResult).toBeVisible();
        await expect(page.getByText('Finding live roles…', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Loading more roles…', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Updating…', { exact: true })).toHaveCount(0, { timeout: 15000 });
    });

    test('TC-JOBS-SEL-001: selecting a result updates the labeled desktop detail region', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        const options = results.getByRole('option');
        if ((await options.count()) === 0) {
            const empty = page
                .locator('text=/being connected|No roles match|Finding live roles/i')
                .first();
            await expect(empty).toBeVisible({ timeout: 15000 });
            return;
        }

        const second = options.nth(1);
        const optionName = await second.getAttribute('aria-label');
        expect(optionName).toMatch(/^View /);
        await second.click();
        await expect(second).toHaveAttribute('aria-selected', 'true');
        await expect(
            page.getByRole('region', {
                name: `Job details: ${optionName!.replace(/^View /, '')}`,
            }),
        ).toBeVisible();
    });

    test('TC-JOBS-LAYOUT-001: xl has three independently scrolling panes without document scroll', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify pane scroll geometry');
        }

        const filters = page.getByRole('region', { name: 'Job filters' });
        const detail = page.getByRole('region', { name: /Job details:/ });
        await expect(filters).toBeVisible();
        await expect(results).toBeVisible();
        await expect(detail).toBeVisible();

        const before = await page.evaluate(() => ({
            pageScrollY: window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
        }));
        expect(before.documentHeight).toBeLessThanOrEqual(before.viewportHeight + 2);

        const paneMetrics = await Promise.all(
            [filters, results, detail].map((pane) =>
                pane.evaluate((node) => {
                    const rect = node.getBoundingClientRect();
                    return {
                        overflowY: getComputedStyle(node).overflowY,
                        height: rect.height,
                        top: rect.top,
                        scrollHeight: node.scrollHeight,
                    };
                }),
            ),
        );
        for (const pane of paneMetrics) {
            expect(pane.overflowY).toBe('auto');
            expect(pane.height).toBeGreaterThan(0);
            expect(pane.height).toBeLessThan(before.viewportHeight);
        }

        await results.evaluate((node) => {
            node.scrollTop = Math.min(400, node.scrollHeight - node.clientHeight);
        });
        await expect.poll(() => results.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

        const after = await Promise.all([
            page.evaluate(() => window.scrollY),
            filters.evaluate((node) => node.getBoundingClientRect().top),
            detail.evaluate((node) => node.getBoundingClientRect().top),
        ]);
        expect(after[0]).toBe(before.pageScrollY);
        expect(Math.abs(after[1] - paneMetrics[0].top)).toBeLessThanOrEqual(1);
        expect(Math.abs(after[2] - paneMetrics[2].top)).toBeLessThanOrEqual(1);
    });

    test('TC-JOBS-LAYOUT-002: lg (1024px) now shows the filter rail directly — no overlay needed', async ({ page }) => {
        // Task 7 moved the filter-rail visibility threshold from xl (1280px) to
        // lg (1024px), collapsing the old "lg: two panes + overlay, xl: three
        // panes" split into one tier: lg+ is always three panes. This test used
        // to assert the rail was ABSENT at 1024px and had to be opened via the
        // "Filters" button/overlay — that tier no longer exists, so the
        // assertions below invert to match (mirrors TC-JOBS-LAYOUT-001's
        // three-pane shape, but pinned to the boundary width itself).
        await page.setViewportSize({ width: 1024, height: 768 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify lg pane geometry');
        }

        const filters = page.getByRole('region', { name: 'Job filters' });
        const detail = page.getByRole('region', { name: /Job details:/ });
        await expect(filters).toBeVisible();
        await expect(results).toBeVisible();
        await expect(detail).toBeVisible();
        // Review fix (2026-07-19): asserting the deleted mobile "Filters"
        // button was absent stopped being meaningful once Task 10 removed it
        // everywhere — the assertion could no longer fail at any viewport.
        // Retargeted at the thing that's actually `lg:hidden` now: Task 10's
        // quick-filter chips row must not coexist with the always-visible
        // rail at lg+.
        await expect(page.getByRole('group', { name: 'Quick filters' })).toHaveCount(0);

        const documentMetrics = await page.evaluate(() => ({
            height: document.documentElement.scrollHeight,
            viewport: window.innerHeight,
        }));
        expect(documentMetrics.height).toBeLessThanOrEqual(documentMetrics.viewport + 2);
    });

    test('TC-JOBS-LAYOUT-002B: below lg, the chips row opens a bounded independently scrolling filter sheet', async ({ page }) => {
        // Coverage for the overlay mechanism, whose trigger threshold Task 7
        // moved down to <1024px alongside the rail. Task 10 absorbed the old
        // standalone "Filters" button + `showFiltersMobile` inline overlay
        // into the mobile chips row's "All (n)" chip, which now opens a
        // bottom Sheet instead — same breakpoint, new trigger + mechanism.
        await page.setViewportSize({ width: 900, height: 768 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify sub-lg overlay geometry');
        }
        await expect(results).toBeVisible();
        await expect(page.getByRole('region', { name: 'Job filters' })).toHaveCount(0);

        await page.getByText('All (', { exact: false }).click();
        const filterOverlay = page.getByRole('region', { name: 'Job filters' });
        await expect(filterOverlay).toBeVisible();
        const overlayMetrics = await filterOverlay.evaluate((node) => ({
            overflowY: getComputedStyle(node).overflowY,
            height: node.getBoundingClientRect().height,
        }));
        expect(overlayMetrics.overflowY).toBe('auto');
        expect(overlayMetrics.height).toBeGreaterThan(0);
        // Unlike TC-JOBS-LAYOUT-002 (>= lg), the page-level scroll containment
        // (`lg:h-[...] lg:overflow-hidden` on PageLayout) doesn't apply below lg
        // — a scrollable document is expected here. Only the overlay itself
        // needs to be internally bounded/scrollable, which the assertions above
        // already cover.
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        expect(overlayMetrics.height).toBeLessThan(viewportHeight);
    });

    test('TC-JOBS-MOBILE-001: deliberate row tap opens bottom sheet detail', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await enterBrowseMode(page);

        const options = page.getByRole('listbox', { name: 'Job results' }).getByRole('option');
        if ((await options.count()) === 0) {
            test.skip(true, 'No job rows for mobile sheet test');
        }

        await options.first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog.getByRole('heading', { level: 2 }).first()).toBeVisible();
    });

    test('TC-JOBS-MOBILE-002: zero-hit refresh closes an open detail sheet', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await enterBrowseMode(page);

        const options = page.getByRole('listbox', { name: 'Job results' }).getByRole('option');
        if ((await options.count()) === 0) {
            test.skip(true, 'No job rows for mobile empty-refresh test');
        }

        // Schedule a zero-result refresh, then deliberately open a still-visible
        // result during the debounce window.
        await page.getByPlaceholder(/live-checked roles/i).fill('zzqxvbnmnevermatches');
        await options.first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });

        // Task 11 replaced the generic copy with "No roles match." + the
        // active-excluder clear-chips (see jobs-first-screen.spec.ts).
        await expect(page.getByText('No roles match.')).toBeVisible({ timeout: 15000 });
        await expect(dialog).toHaveCount(0);
    });
});
