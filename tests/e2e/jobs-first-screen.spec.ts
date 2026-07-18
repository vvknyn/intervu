import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-FIRST-SCREEN - /jobs renders on first paint, no entry gate
 *
 * Grows across the /jobs redesign tasks. Task 4 removes the JobsEntryGate
 * ask/choose screens entirely — mode now starts at "browse" and the results
 * UI is the only render path, so job rows (or an honest empty/error state)
 * must appear with zero interaction.
 *
 * Environment-tolerant like jobs-search-polish.spec.ts: this suite runs
 * against a real dev server, and Meilisearch may or may not be configured
 * there. Assertions never depend on which branch is active except the
 * negative gate check, which must hold either way.
 *
 * Structural, not text-based: a later task adds an upsell card containing
 * wording similar to the old gate's ("Upload résumé"), so the negative
 * assertion below targets the gate's distinctive CTA button — "No, I'll
 * search", which existed ONLY on the deleted ASK screen — never job-adjacent
 * copy that a future card could also contain.
 */

test.describe('JOBS-FIRST-SCREEN - gate-free entry', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* private mode / storage disabled */
            }
        });
    });

    test('anonymous first paint shows job rows — no gate, no interaction', async ({ page }) => {
        await page.goto('/jobs');

        // Structural gate check: the ASK screen's "No, I'll search" button
        // must never render — it existed only in JobsEntryGate, now deleted.
        await expect(page.getByRole('button', { name: /No, I.?ll search/i })).toHaveCount(0);

        // Results render on first paint, no click/type required: an actual job
        // row (JobRow carries `data-job-row`), or — tolerant of an unconfigured
        // Meilisearch in this environment — one of the honest empty/error
        // surfaces the results view falls back to. Never the gate.
        const resultsOrEmpty = page
            .locator('[data-job-row]')
            .or(page.getByText(/being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/temporarily unavailable/i))
            .first();
        await expect(resultsOrEmpty).toBeVisible({ timeout: 10_000 });
    });

    test('legacy entry key is cleaned up', async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.setItem('intervu.jobs.entry', JSON.stringify({ mode: 'browse' }));
            } catch {
                /* private mode / storage disabled */
            }
        });
        await page.goto('/jobs');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => localStorage.getItem('intervu.jobs.entry'))).toBeNull();
    });

    test("deep link reconstructs the exact screen", async ({ page }) => {
        await page.goto("/jobs?q=engineer&work=remote&posted=7d&salary=150k");
        await expect(page.getByRole("textbox").first()).toHaveValue("engineer");
        // Active filter chips reflect the URL (chip text per existing chips loop at page.tsx:1254-1263):
        await expect(page.getByText("Remote", { exact: false }).first()).toBeVisible();
    });

    test("opening a job pushes a URL; back closes the detail", async ({ page }) => {
        await page.goto("/jobs");
        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await page.goBack();
        await expect(page).not.toHaveURL(/job=/);
    });

    test("refresh reproduces the same results state", async ({ page }) => {
        await page.goto("/jobs?posted=7d");
        const countBefore = await page.getByText(/roles|results/i).first().textContent();
        await page.reload();
        await expect(page.getByText(/roles|results/i).first()).toHaveText(countBefore ?? "");
    });

    /**
     * Reviewer finding (Task 5 review): only `job` was re-derived from the URL
     * after mount — q/facets/salaryMin/visaOnly/postedBucket/sort/hideGhosts
     * were seeded once and never reconciled on history navigation. Reachable
     * drift: open a job (push adds a history entry on top of `?q=engineer`) →
     * edit the query to "designer" (replace rewrites only the TOP entry) →
     * press Back → the URL reverts to `?q=engineer` but the screen kept
     * showing "designer". The fix makes the URL the reactive source for every
     * parsed field, not just `job`, so Back always matches the address bar.
     */
    test("back after opening a job and editing the query restores the URL's query, not the edited one", async ({ page }) => {
        await page.goto("/jobs?q=engineer");
        const searchInput = page.getByRole("textbox").first();
        await expect(searchInput).toHaveValue("engineer");

        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await expect(page).toHaveURL(/q=engineer/);

        // Replace rewrites only the top history entry (the job-open one) —
        // this is the drift the reviewer flagged.
        await searchInput.fill("designer");
        await expect(searchInput).toHaveValue("designer");
        await expect(page).toHaveURL(/q=designer/);

        await page.goBack();
        await expect(page).toHaveURL(/q=engineer/);
        await expect(page).not.toHaveURL(/q=designer/);
        await expect(searchInput).toHaveValue("engineer");
    });

    /**
     * Class coverage, not just the `q` instance: the same drift is reachable
     * through a filter mutation. Open a job (push → `?job=`), then apply the
     * "Last week" posted-bucket filter from the rail (replace, on top of the
     * push — mirroring the reviewer's push-then-replace pattern for a
     * non-`q` field, carrying `job=` along since `buildUrlState()` defaults
     * `jobId` to whatever the URL currently holds). Back must unwind past
     * BOTH: the URL reverts to the bare `/jobs` entry, and the screen must
     * match — no `posted` filter, no active chip, no open detail. Starts
     * from the unfiltered default view (always has rows, per the "anonymous
     * first paint" test above) rather than a pre-filtered URL, so this test
     * isn't sensitive to how many roles currently fall in the 7-day bucket.
     */
    test("back after opening a job and applying a posted-bucket filter restores the prior state", async ({ page }) => {
        await page.goto("/jobs");
        const firstRow = page.locator("[data-testid=job-row], main li").first();
        await firstRow.click();
        await expect(page).toHaveURL(/job=/);
        await expect(page).not.toHaveURL(/posted=/);

        const postedButton = page
            .getByRole("region", { name: "Job filters" })
            .getByRole("button", { name: "Last week" });
        await postedButton.click();
        await expect(page).toHaveURL(/posted=7d/);
        await expect(page).toHaveURL(/job=/); // replace preserves the open job
        await expect(page.getByTestId("active-filter-chip").filter({ hasText: "Last week" })).toBeVisible();

        await page.goBack();
        await expect(page).not.toHaveURL(/posted=7d/);
        await expect(page).not.toHaveURL(/job=/);
        await expect(page.getByTestId("active-filter-chip")).toHaveCount(0);
    });
});
