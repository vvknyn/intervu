import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-SPLIT-VIEW - desktop two-panel selector (list + sticky
 * detail pane) at xl+ (>=1280px)
 *
 * Two-Panel Selector (master-detail), the standard jobs-SERP desktop
 * pattern (see splitview-report.md). Below xl, behavior is unchanged from
 * today — the bottom Sheet, byte-for-byte — and jobs-first-screen.spec.ts /
 * mobile.spec.ts already prove that at their own sub-xl viewports; this
 * file proves only the NEW xl+ pane behavior, plus one guard (last
 * describe block) that the sheet path still works below xl.
 *
 * CRITICAL viewport note: Playwright's `devices['Desktop Chrome']` default
 * viewport (playwright.config.ts) is 1280×720 — the exact same number as
 * Tailwind's `xl` breakpoint (`min-width: 1280px`). Every test in this file
 * therefore sets an EXPLICIT viewport (never relies on the implicit
 * default) — 1440×900 for the xl+ pane tests (brief's own choice, clear of
 * the 1280 boundary) and 1100×800 for the below-xl guard (same width
 * jobs-first-screen.spec.ts's "desktop 1100px" test and its whole
 * gate-free-entry describe block use, for the identical reason: it sits
 * cleanly between `lg` (1024) and `xl` (1280)).
 *
 * Environment-tolerant like the other /jobs e2e suites: this runs against a
 * live server with LIVE Meilisearch, but tests that need real rows skip
 * cleanly if the corpus returns none for the environment at run time.
 */

async function enterBrowseMode(page: Page) {
    await page.addInitScript(() => {
        try {
            window.localStorage.clear();
        } catch {
            /* private mode / storage disabled */
        }
    });
    await page.goto('/jobs?posted=any');
    await page.waitForLoadState('networkidle');
    await expect(
        page.getByRole('listbox', { name: 'Job results' })
            .or(page.getByText(/Job search is being connected/i))
            .or(page.getByText(/No roles match/i))
            .or(page.getByText(/Job search is temporarily unavailable/i))
            .first(),
    ).toBeVisible({ timeout: 15000 });
}

test.describe('JOBS-SPLIT-VIEW - xl+ two-panel selector', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('(a) renders the list AND a placeholder pane, no sheet', async ({ page }) => {
        await enterBrowseMode(page);

        await expect(page.getByRole('listbox', { name: 'Job results' })).toBeVisible();
        const pane = page.getByTestId('detail-pane');
        await expect(pane).toBeVisible();
        // No auto-select in v1 — the placeholder, not a job, is what a
        // fresh xl+ landing shows (see resolveDetailMountSite's doc
        // comment, lib/jobs/result-state.ts).
        await expect(page.getByTestId('detail-pane-placeholder')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('(b) clicking the first row shows that job in the pane; list stays visible; URL carries ?job=', async ({ page }) => {
        await enterBrowseMode(page);
        const rows = page.getByTestId('job-row');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No job rows in the live corpus for this environment');
        }
        const firstRow = rows.first();
        const title = (await firstRow.getByTestId('job-title').textContent())!.trim();

        await firstRow.click();

        const pane = page.getByTestId('detail-pane');
        await expect(pane.locator('h2').first()).toHaveText(title, { timeout: 10000 });
        await expect(page.getByTestId('detail-pane-placeholder')).toHaveCount(0);
        // A pane, not a modal takeover — the list stays visible and
        // reachable (unlike the sheet, which marks the background
        // aria-hidden).
        await expect(page.getByRole('listbox', { name: 'Job results' })).toBeVisible();
        await expect(firstRow).toBeVisible();
        await expect(page).toHaveURL(/[?&]job=/);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('(c) pane close (×) returns to the placeholder and clears ?job=', async ({ page }) => {
        await enterBrowseMode(page);
        const rows = page.getByTestId('job-row');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No job rows in the live corpus for this environment');
        }
        await rows.first().click();
        const pane = page.getByTestId('detail-pane');
        await expect(pane.locator('h2').first()).toBeVisible({ timeout: 10000 });
        await expect(page).toHaveURL(/[?&]job=/);

        // JobDetail's own built-in × (aria-label="Close") — the exact same
        // onClose (`() => router.back()`) the sheet's own close uses; no
        // separate close affordance was built for the pane.
        await pane.getByRole('button', { name: 'Close' }).click();

        await expect(page.getByTestId('detail-pane-placeholder')).toBeVisible();
        await expect(page).not.toHaveURL(/[?&]job=/);
    });
});

test.describe('JOBS-SPLIT-VIEW - below xl still uses the sheet', () => {
    // Explicit sub-xl viewport — see file header. Never the implicit
    // default here.
    test.use({ viewport: { width: 1100, height: 800 } });

    test('(d) a job deep link renders the sheet, not the pane', async ({ page }) => {
        await enterBrowseMode(page);
        const rows = page.getByTestId('job-row');
        if ((await rows.count()) === 0) {
            test.skip(true, 'No job rows in the live corpus for this environment');
        }
        // Open a real job via a click first, to read a real id off the URL
        // (native pushState — see openJob, jobs/page.tsx), then reload as a
        // fresh deep link to also cover the SSR-initial path.
        await rows.first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });
        const url = new URL(page.url());
        const jobId = url.searchParams.get('job');
        expect(jobId).toBeTruthy();

        await page.goto(`/jobs?posted=any&job=${jobId}`);

        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('detail-pane')).not.toBeVisible();
    });
});
