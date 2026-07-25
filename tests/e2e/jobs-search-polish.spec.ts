import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SEARCH - /jobs search polish (sort, panes, selection)
 *
 * Environment-tolerant: works with configured Meilisearch OR unconfigured backend.
 * There is no entry gate — jobs render BROWSE results on first paint for
 * everyone (see jobs-first-screen.spec.ts) — so this just navigates straight in.
 */

async function enterBrowseMode(page: Page) {
    // Portal redesign flipped jobs to the root route (`/jobs` now 301s here —
    // next.config.ts's `redirects()`); going straight there skips the hop.
    //
    // Some intent is now required to reach the ledger at all: `/` with nothing
    // asked for renders the ask screen instead of browsing the corpus. The
    // intent used here is a FILTER (`posted=any`, i.e. no date restriction)
    // rather than a query, because a query would also change what these suites
    // measure — relevance ranking would displace the default "freshest" sort,
    // and TC-JOBS-SORT-001/002 assert precisely that default. A filter leaves
    // the query empty and the sort untouched, so this stays the old
    // browse-everything landing in every respect the tests care about.
    await page.goto('/?posted=any');
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

    // Portal redesign rewrite: the "Sort results" combobox (Date posted /
    // Salary high to low / Best match, with Best match disabled sans query)
    // is gone — sort is now three plain `SortSegment` buttons (page.tsx:
    // freshest / top pay / best match), each a real `aria-pressed` toggle,
    // gated as a group on `result?.configured` the same way the old
    // combobox was. "top pay" and "best match" always render when
    // configured; "freshest" only when `postedDateSupported` — guarded
    // separately rather than folded into the top-level configured check.
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
        await page.goto('/?q=Technical%20Account%20Manager');
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

    test('TC-JOBS-SORT-001: sort segments offer freshest / top pay / best match when configured', async ({ page }) => {
        await enterBrowseMode(page);

        const topPay = page.getByRole('button', { name: 'top pay' });
        const configured = (await topPay.count()) > 0;

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

        const bestMatch = page.getByRole('button', { name: 'best match' });
        await expect(bestMatch).toBeVisible();

        const freshest = page.getByRole('button', { name: 'freshest' });
        if ((await freshest.count()) > 0) {
            // Default landing sort (no query, no explicit override) is
            // "newest" — freshest starts pressed; best match has nothing to
            // rank without a query or an active résumé fit.
            await expect(freshest).toHaveAttribute('aria-pressed', 'true');
            await expect(bestMatch).toHaveAttribute('aria-pressed', 'false');
        }

        await topPay.click();
        await expect(topPay).toHaveAttribute('aria-pressed', 'true');
        if ((await freshest.count()) > 0) {
            await expect(freshest).toHaveAttribute('aria-pressed', 'false');
        }
        await expect(page).toHaveURL(/sort=salary/);
    });

    test('TC-JOBS-SORT-002: clearing query resets best-match/relevance sort to freshest', async ({ page }) => {
        await enterBrowseMode(page);

        const bestMatch = page.getByRole('button', { name: 'best match' });
        if ((await bestMatch.count()) === 0) {
            test.skip(true, 'Backend unconfigured — sort segments absent');
        }
        const freshest = page.getByRole('button', { name: 'freshest' });
        if ((await freshest.count()) === 0) {
            test.skip(true, 'Corpus carries no posted_ts — freshest segment hidden');
        }

        const searchInput = page.getByPlaceholder(/live-checked roles/i);
        await searchInput.fill('engineer');
        await expect(page).toHaveURL(/q=engineer/);

        // With a query, "best match" is plain relevance (chooseSort), not the
        // résumé-rank action — see jobs-first-screen.spec.ts's "best match
        // with no query" test for that other branch.
        await bestMatch.click();
        await expect(bestMatch).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/sort=relevance/);

        await searchInput.fill('');
        await expect(freshest).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
        await expect(bestMatch).toHaveAttribute('aria-pressed', 'false');
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

        const results = page.getByRole('listbox', { name: 'Job results' });
        const options = results.getByRole('option');
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

        await second.click();
        await expect(second).toHaveAttribute('aria-selected', 'true');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('heading', { level: 2 }).first()).toHaveText(title);
    });

    // Portal redesign rewrite: the old lg+ three-pane layout (filters |
    // results | detail, all inline) is gone. Detail now opens exclusively
    // via the bottom Sheet at every breakpoint (jobs-first-screen.spec.ts's
    // dead-job/opening-a-job tests cover that), and filters moved into that
    // same Sheet behind "All filters" (TC-JOBS-LAYOUT-002 below). The two
    // panes that remain inline at lg+ are the results list and the sidebar
    // (pipeline + ghost-radar cards, `<aside>` in page.tsx) — this proves
    // both still scroll independently of the document and of each other,
    // same INTENT as the old three-pane test, just two panes now.
    test('TC-JOBS-LAYOUT-001: lg+ contains document scroll; results and sidebar scroll independently', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
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

        const results = page.getByRole('listbox', { name: 'Job results' });
        const rows = results.getByRole('option');
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

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify lg pane geometry');
        }
        await expect(results).toBeVisible();
        await expect(page.getByRole('region', { name: 'Job filters' })).toHaveCount(0);

        const documentMetrics = await page.evaluate(() => ({
            height: document.documentElement.scrollHeight,
            viewport: window.innerHeight,
        }));
        expect(documentMetrics.height).toBeLessThanOrEqual(documentMetrics.viewport + 2);

        await page.getByRole('button', { name: /filters \+/ }).click();
        await expect(page.getByRole('region', { name: 'Job filters' })).toBeVisible();
    });

    test('TC-JOBS-LAYOUT-002B: below lg, the same "All filters" sheet opens a bounded, independently scrolling filter surface', async ({ page }) => {
        // Proves width-independence of the unified mechanism above: the
        // trigger and the sheet geometry are identical below lg, not a
        // separate code path (Task 10 used to absorb a standalone "Filters"
        // button into a mobile-only chips row at this same breakpoint; the
        // portal redesign went further and unified the trigger itself).
        await page.setViewportSize({ width: 900, height: 768 });
        await enterBrowseMode(page);

        const results = page.getByRole('listbox', { name: 'Job results' });
        if ((await results.getByRole('option').count()) === 0) {
            test.skip(true, 'No job rows — cannot verify sub-lg overlay geometry');
        }
        await expect(results).toBeVisible();
        await expect(page.getByRole('region', { name: 'Job filters' })).toHaveCount(0);

        await page.getByRole('button', { name: /filters \+/ }).click();
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
