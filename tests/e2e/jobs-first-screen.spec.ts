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
});
