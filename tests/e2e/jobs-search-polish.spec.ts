import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SEARCH - /jobs search polish (sort, panes, selection)
 *
 * Environment-tolerant: works with configured Meilisearch OR unconfigured backend.
 * There is no entry gate — jobs render BROWSE results on first paint for
 * everyone (see jobs-first-screen.spec.ts) — so this just navigates straight in.
 */

const sortTrigger = (page: Page) => page.getByTestId('jobs-sort-trigger');

/** Open the sort menu and pick an item by its test id suffix (newest | salary | relevance). */
async function chooseSortItem(page: Page, item: 'newest' | 'salary' | 'relevance') {
    await sortTrigger(page).click();
    await page.getByRole('menuitem').and(page.getByTestId(`jobs-sort-${item}`)).click();
}

async function enterBrowseMode(page: Page) {
    // `/` is now a straight redirect to `/jobs` (the board IS the front
    // door, #145) — going straight to `/jobs` is the direct route, not a
    // workaround for a marketing front door that no longer exists.
    //
    // Browse-by-default (#152) means `/jobs` with NOTHING asked for now
    // browses the corpus too — no ask screen stands between a bare visit and
    // real rows anymore. The intent stated here is still a FILTER
    // (`posted=any`, i.e. no date restriction) rather than a query, because a
    // query would change what these suites measure — relevance ranking would
    // displace the default "freshest" sort, and TC-JOBS-SORT-001/002 assert
    // precisely that default. A filter leaves the query empty and the sort
    // untouched, so this stays the browse-everything landing in every
    // respect the tests care about.
    await page.goto('/jobs?posted=any');
    await page.waitForLoadState('networkidle');
    await expect(
        page.getByRole('region', { name: 'Job results' })
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

    // Sort is one DropdownMenu at every width (JobsContent.tsx `sortEl`):
    // a "Sort: <label>" trigger (`jobs-sort-trigger`) opening menu items
    // (`jobs-sort-newest` / `-salary` / `-relevance`), gated on
    // `result?.configured`. The current choice shows in the trigger text and
    // as a check on the item (items are `menuitem`, not radios). "Freshest"
    // renders only when `postedDateSupported`.
    //
    // Résumé-fold (2026-08): the relevance item's label is résumé-aware —
    // "Best match" with a résumé on file, "Relevance" otherwise. Playwright
    // never signs in here, so every test below sees "Relevance".
    /**
     * A multi-word role search must not answer with rows that matched only one
     * of its words.
     *
     * Meilisearch's default `matchingStrategy` is "last", which drops query
     * words from the end until something matches. Observed live: "Technical
     * Account Manager" returned Reliability Maintenance Technician, Field
     * Engineer and Senior Developer — rows that matched "Technical" alone (and
     * some only inside a description). `searchMeili` now searches with "all"
     * and relaxes to "last" only after strict matching returns nothing.
     *
     * Asserted structurally rather than by naming expected employers: the
     * corpus is live and its top hits change. What must hold is that visible
     * titles relate to the query — the failure mode was titles sharing NO
     * distinctive word with it.
     */
    test('TC-JOBS-RELEVANCE-001: a multi-word role search returns rows that match its words', async ({ page }) => {
        await page.goto('/jobs?q=Technical%20Account%20Manager');
        await page.waitForLoadState('networkidle');

        const rows = page.getByTestId('job-row');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No rows for this query in the current corpus');
        }

        const titles = (await rows.allInnerTexts()).join(' ').toLowerCase();

        // "account" and "manager" are the words the broken ladder dropped;
        // matching on "technical" alone was the whole bug.
        expect(titles).toMatch(/account|manager/);
    });

    test('TC-JOBS-SORT-001: sort menu offers freshest / top pay / relevance when configured', async ({ page }) => {
        await enterBrowseMode(page);

        const configured = (await sortTrigger(page).count()) > 0;

        if (!configured) {
            // Same tolerant set `enterBrowseMode` already waited on above —
            // widened to include "temporarily unavailable" (a transport
            // error, distinct from "unconfigured"), which the original
            // narrower list here missed.
            const empty = page
                .locator('text=/being connected/i')
                .or(page.locator('text=/Finding live roles/i'))
                .or(page.locator('text=/No roles match/i'))
                .or(page.locator('text=/temporarily unavailable/i'))
                .first();
            await expect(empty).toBeVisible({ timeout: 15000 });
            return;
        }

        await sortTrigger(page).click();
        await expect(page.getByTestId('jobs-sort-relevance')).toBeVisible();
        await expect(page.getByTestId('jobs-sort-salary')).toBeVisible();
        const hasFreshest = (await page.getByTestId('jobs-sort-newest').count()) > 0;
        await page.keyboard.press('Escape');

        if (hasFreshest) {
            // Default landing sort (no query, no explicit override) is "newest".
            await expect(sortTrigger(page)).toContainText('Sort: Freshest');
        }

        await chooseSortItem(page, 'salary');
        await expect(sortTrigger(page)).toContainText('Sort: Top pay');
        await expect(page).toHaveURL(/sort=salary/);
    });

    test('TC-JOBS-SORT-002: clearing query resets relevance sort to freshest', async ({ page }) => {
        await enterBrowseMode(page);

        if ((await sortTrigger(page).count()) === 0) {
            test.skip(true, 'Backend unconfigured — sort menu absent');
        }
        await sortTrigger(page).click();
        const hasFreshest = (await page.getByTestId('jobs-sort-newest').count()) > 0;
        await page.keyboard.press('Escape');
        if (!hasFreshest) {
            test.skip(true, 'Corpus carries no posted_ts — freshest item hidden');
        }

        const searchInput = page.getByPlaceholder(/Job title/i);
        await searchInput.fill('engineer');
        await expect(page).toHaveURL(/q=engineer/);

        // Signed out (no résumé on file), this item is always plain
        // relevance sort (`chooseBestMatch`) — never the résumé-rank action,
        // which only activates when `resumeOnFile === true`.
        await chooseSortItem(page, 'relevance');
        await expect(sortTrigger(page)).toContainText('Sort: Relevance');
        await expect(page).toHaveURL(/sort=relevance/);

        await searchInput.fill('');
        await expect(sortTrigger(page)).toContainText('Sort: Freshest', { timeout: 15000 });
    });

    test('TC-JOBS-SORT-003: sort and filter order do not change matched count or ID set', async ({ page }) => {
        const q = 'product%20manager';
        await page.goto(`/jobs?q=${q}&work_type=remote&experience_level=senior&posted=any`);
        await page.waitForLoadState('networkidle');

        if ((await sortTrigger(page).count()) === 0) {
            test.skip(true, 'Backend unconfigured — sort menu absent');
        }
        await sortTrigger(page).click();
        const hasFreshest = (await page.getByTestId('jobs-sort-newest').count()) > 0;
        await page.keyboard.press('Escape');
        if (!hasFreshest) {
            test.skip(true, 'Corpus carries no posted_ts — freshest item hidden');
        }

        const resultLine = page.getByTestId('result-line');
        await expect(resultLine).toBeVisible({ timeout: 15000 });
        const initialCount = (await resultLine.textContent())?.trim() ?? '';
        if (!initialCount || /No roles match/i.test(initialCount)) {
            test.skip(true, 'No rows for this query in the current corpus');
        }

        // Compare totals, not the first page of titles: an explicit sort
        // reorders the same matched set, so page 1's rows legitimately change.
        await chooseSortItem(page, 'newest');
        await expect(page).toHaveURL(/sort=newest/);
        await expect.poll(async () => (await resultLine.textContent())?.trim() ?? '').toBe(initialCount);

        await chooseSortItem(page, 'salary');
        await expect(page).toHaveURL(/sort=salary/);
        await expect.poll(async () => (await resultLine.textContent())?.trim() ?? '').toBe(initialCount);

        await chooseSortItem(page, 'relevance');
        await expect(page).toHaveURL(/sort=relevance/);
        await expect.poll(async () => (await resultLine.textContent())?.trim() ?? '').toBe(initialCount);

        // Reverse filter apply order on a fresh navigation — same total.
        await page.goto(`/jobs?q=${q}&experience_level=senior&work_type=remote&posted=any`);
        await page.waitForLoadState('networkidle');
        await expect(resultLine).toBeVisible({ timeout: 15000 });
        await expect.poll(async () => (await resultLine.textContent())?.trim() ?? '').toBe(initialCount);
    });

    test('TC-JOBS-REFRESH-001: refetch keeps current results visible and shows in-flight feedback', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        const firstResult = results.getByRole('article').first();
        if ((await firstResult.count()) === 0) {
            test.skip(true, 'No job rows — cannot verify background refresh feedback');
        }

        await page.getByPlaceholder(/Job title/i).fill('engineer');
        await expect(page.getByText('Updating…', { exact: true })).toBeVisible({ timeout: 2000 });
        await expect(firstResult).toBeVisible();
        // WaitState renders role=status with its label in an sr-only span at every stage, so this sees
        // the wait even before the 2 s text line appears (the old ellipsis text never matched).
        const waitFor = (label: string) => page.getByRole('status').filter({ hasText: label });
        await expect(waitFor('Finding live roles')).toHaveCount(0);
        await expect(waitFor('Loading more roles')).toHaveCount(0);
        await expect(page.getByText('Updating…', { exact: true })).toHaveCount(0, { timeout: 15000 });
    });

    // Portal redesign rewrite: detail no longer opens as an inline labeled
    // "Job details: …" region — it's the bottom Sheet (role="dialog") at
    // every breakpoint. The old test matched the option's aria-label
    // ("View {title} at {company}") against the region's own name; the
    // Sheet's `<h2>` (JobDetail, page.tsx) instead carries the title ALONE,
    // so this compares against the card's own `data-testid="job-title"`
    // span rather than re-deriving it from the aria-label string.
    test('TC-JOBS-SEL-001: selecting a result opens its detail sheet', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        const options = results.getByRole('article');
        if ((await options.count()) === 0) {
            const empty = page
                .locator('text=/being connected|No roles match|Finding live roles|temporarily unavailable/i')
                .first();
            await expect(empty).toBeVisible({ timeout: 15000 });
            return;
        }

        const second = options.nth(1);
        const optionName = await second.getAttribute('aria-label');
        expect(optionName).toMatch(/^View /);
        const title = (await second.getByTestId('job-title').textContent())!.trim();

        // Everything after the click uses a TEST-ID locator, not the role one.
        // Opening the detail sheet makes it modal, and a modal marks the rest
        // of the page aria-hidden — measured: role=option resolves 30 before
        // the click and 0 after, while the same rows still resolve by test id.
        // So `second` (a getByRole locator) is unresolvable from here on; that
        // is correct accessibility behaviour, not a regression, and asserting
        // through it can only ever time out.
        const secondByTestId = page.getByTestId('job-row').nth(1);
        await second.click();
        await expect(secondByTestId).toHaveAttribute('aria-current', 'true');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // NOT `.first()`: the sheet's own accessible label is an sr-only <h2>
        // ("<title> at <company>", required by Radix Dialog), so the first
        // level-2 heading in the dialog is that label rather than the visible
        // job heading — matching it against the bare title could only fail.
        await expect(dialog.locator('h2:not(.sr-only)').first()).toHaveText(title);
    });

    // Portal redesign rewrite: the old lg+ three-pane layout (filters |
    // results | detail, all inline) is gone. Detail opens via the bottom
    // Sheet below xl, and in the sticky split-view pane at xl+ (2026-08-08
    // Two-Panel Selector — see resolveDetailMountSite; jobs-split-view
    // .spec.ts covers the pane, jobs-first-screen.spec.ts's dead-job/
    // opening-a-job tests cover the sheet), and filters moved into that
    // same Sheet behind "All filters" (TC-JOBS-LAYOUT-002 below). The two
    // panes that remain inline at lg+ are the results list and the sidebar
    // (pipeline + ghost-radar cards, `<aside>` in page.tsx) — this proves
    // both still scroll independently of the document and of each other,
    // same INTENT as the old three-pane test, just two panes now.
    test('TC-JOBS-LAYOUT-001: lg+ contains document scroll; results and sidebar scroll independently', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        if ((await results.getByRole('article').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify pane scroll geometry');
        }

        const sidebar = page.getByRole('complementary');
        await expect(results).toBeVisible();
        await expect(sidebar).toBeVisible();

        const before = await page.evaluate(() => ({
            pageScrollY: window.scrollY,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
        }));
        expect(before.documentHeight).toBeLessThanOrEqual(before.viewportHeight + 2);

        const paneMetrics = await Promise.all(
            [results, sidebar].map((pane) =>
                pane.evaluate((node) => {
                    const rect = node.getBoundingClientRect();
                    return {
                        overflowY: getComputedStyle(node).overflowY,
                        height: rect.height,
                        top: rect.top,
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
            sidebar.evaluate((node) => node.getBoundingClientRect().top),
        ]);
        expect(after[0]).toBe(before.pageScrollY);
        expect(Math.abs(after[1] - paneMetrics[1].top)).toBeLessThanOrEqual(1);
    });

    /**
     * The results pane must be the thing that scrolls, and reaching its end
     * must load the next page.
     *
     * TC-JOBS-LAYOUT-001 above pins document-scroll CONTAINMENT; this pins the
     * consequence users actually feel when the same height chain breaks.
     * Observed in production: the pane's wrapper was a bare block, so the
     * scroller resolved to `height: auto` and grew to the height of every
     * loaded row instead of scrolling — `main`'s `lg:overflow-hidden` clipped
     * the surplus, the infinite-scroll sentinel sat ~1500px below the clip
     * where no scrolling could ever reveal it, and paging simply stopped after
     * the first page while the count line still promised 1,769 roles.
     *
     * Containment alone wouldn't have caught it (the document stayed nearly
     * contained — it grew by only ~150px), which is why this asserts the pane
     * genuinely overflows its own box AND that driving it to the bottom
     * appends rows. Scrolling is programmatic on purpose: a wheel gesture over
     * a pane that isn't scrollable silently scrolls an ancestor instead and
     * would mask exactly this failure.
     */
    test('TC-JOBS-LAYOUT-003: the results pane scrolls itself, and reaching its end loads the next page', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        const rows = results.getByRole('article');
        const initial = await rows.count();
        if (initial === 0) test.skip(true, 'No job rows — cannot verify pane scrolling or paging');

        // The pane overflows its own box, i.e. it is the scroller. When the
        // height chain breaks this is exactly equal, not greater.
        const geometry = await results.evaluate((node) => ({
            scrollH: node.scrollHeight,
            clientH: node.clientHeight,
            viewportH: window.innerHeight,
        }));
        expect(geometry.clientH).toBeLessThan(geometry.viewportH);
        expect(geometry.scrollH).toBeGreaterThan(geometry.clientH);

        // Only meaningful while more pages exist; an exhausted result set
        // legitimately stops growing.
        const exhausted = await page.getByText(/reached the end/i).isVisible().catch(() => false);
        if (exhausted) test.skip(true, 'Result set already exhausted — nothing left to page');

        await results.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
        });
        await expect.poll(() => rows.count(), { timeout: 20000 }).toBeGreaterThan(initial);
    });

    // Portal redesign rewrite: Task 7's lg-rail is gone at EVERY width now —
    // filters live only behind the pills row's "All filters" sheet, mobile
    // and desktop alike (FilterChipsRow, the old rail component AND the old
    // mobile "Quick filters" chips group, are both dead code — neither
    // renders anywhere in page.tsx). The lg/sub-lg split this test used to
    // pin no longer exists as a real distinction; what's left worth proving
    // at this same 1024px boundary is that the document-scroll containment
    // (`lg:overflow-hidden`) still holds AND that filters still require a
    // click to reach — no inline rail resurfaced here either.
    test('TC-JOBS-LAYOUT-002: at lg (1024px), filters still live behind the "All filters" sheet', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        if ((await results.getByRole('article').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify lg pane geometry');
        }
        await expect(results).toBeVisible();
        await expect(page.getByTestId('filters-panel')).toHaveCount(0);

        const documentMetrics = await page.evaluate(() => ({
            height: document.documentElement.scrollHeight,
            viewport: window.innerHeight,
        }));
        expect(documentMetrics.height).toBeLessThanOrEqual(documentMetrics.viewport + 2);

        await page.getByTestId('filters-toggle').click();
        await expect(page.getByTestId('filters-panel')).toBeVisible();
    });

    test('TC-JOBS-LAYOUT-002B: below lg, the same "All filters" sheet opens a bounded, independently scrolling filter surface', async ({ page }) => {
        // Proves width-independence of the unified mechanism above: the
        // trigger and the sheet geometry are identical below lg, not a
        // separate code path (Task 10 used to absorb a standalone "Filters"
        // button into a mobile-only chips row at this same breakpoint; the
        // portal redesign went further and unified the trigger itself).
        await page.setViewportSize({ width: 900, height: 768 });
        await enterBrowseMode(page);

        const results = page.getByRole('region', { name: 'Job results' });
        if ((await results.getByRole('article').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify sub-lg overlay geometry');
        }
        await expect(results).toBeVisible();
        await expect(page.getByTestId('filters-panel')).toHaveCount(0);

        await page.getByTestId('filters-toggle').click();
        const filterOverlay = page.getByTestId('filters-panel');
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

        const options = page.getByRole('region', { name: 'Job results' }).getByRole('article');
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

        const options = page.getByRole('region', { name: 'Job results' }).getByRole('article');
        if ((await options.count()) === 0) {
            test.skip(true, 'No job rows for mobile empty-refresh test');
        }

        // Schedule a zero-result refresh, then deliberately open a still-visible
        // result during the debounce window.
        await page.getByPlaceholder(/Job title/i).fill('zzqxvbnmnevermatches');
        await options.first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });

        // Task 11 replaced the generic copy with "No roles match." + the
        // active-excluder clear-chips (see jobs-first-screen.spec.ts).
        await expect(page.getByText('No roles match.')).toBeVisible({ timeout: 15000 });
        await expect(dialog).toHaveCount(0);
    });
});
