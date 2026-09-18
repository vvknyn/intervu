import { test, expect } from '@playwright/test';

/**
 * TEST GROUP: JOBS-VISIT-BANNER-AND-SAVED-SEARCH
 *
 * Round 2 of the W2 engagement cluster — the board "posted since your last
 * visit" banner (BoardVisitBanner.tsx) and saved-search save/list wiring
 * (SavedSearchesPanel.tsx). Sits beside jobs-first-screen.spec.ts and
 * matches its register: environment-tolerant assertions (real rows OR an
 * honest empty/error surface), no dependence on live corpus contents.
 *
 * No auth fixture exists in this repo (grep confirms — every e2e spec here
 * is anonymous), so the saved-search case below is the guest localStorage
 * path only. The server-backed signed-in path (use-saved-searches.ts,
 * SavedSearchesPanel.tsx's auth-branching mutations) has no e2e coverage
 * for the same reason follows/pursuits' signed-in paths don't.
 *
 * playwright.config.ts carries no globalSetup and no storageState — a fresh
 * Playwright test context starts with empty localStorage already, before
 * this file's own `addInitScript` clear even runs. The clear below is kept
 * anyway (same belt-and-suspenders idiom jobs-first-screen.spec.ts uses in
 * its "gate-free entry" describe block) so this suite's honesty-gate
 * assertion doesn't silently depend on that invariant continuing to hold.
 */

test.describe('board visit banner — honesty gate', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* private mode / storage disabled */
            }
        });
    });

    /**
     * `resolveVisitBannerState`'s class case (tests/unit/visit-banner.test.ts):
     * no stored board cursor must never render "since your last visit",
     * however large the server-side count would be. A first-ever visit has
     * no cursor by construction, so the banner must be structurally absent —
     * not just visually empty — from first paint.
     */
    test('banner is absent on a first-ever /jobs visit', async ({ page }) => {
        await page.goto('/jobs?posted=any');

        // Real rows on first paint (or an honest empty/error surface) — same
        // tolerant wait jobs-first-screen.spec.ts uses everywhere, so this
        // assertion isn't coupled to live corpus contents.
        await expect(
            page
                .locator('[data-job-row]')
                .or(page.getByText(/No roles match/i))
                .or(page.getByText(/being connected/i))
                .or(page.getByText(/temporarily unavailable/i))
                .first(),
        ).toBeVisible({ timeout: 20_000 });

        await expect(page.getByTestId('board-visit-banner')).toHaveCount(0);
    });

    /**
     * Revisiting shortly after mount plants a board cursor (BoardVisitBanner
     * always writes on mount, after its read — see visit-banner-and-saved-
     * search work). A reload seconds later diffs against a cursor from
     * seconds ago, so the "new since cursor" count is almost certainly 0 —
     * this does NOT assert the banner is absent (a false negative if the
     * live corpus happened to get a posting in that window), only that nothing
     * broke: the results pipeline still renders normally and the page never
     * throws an uncaught error.
     */
    test('revisiting shortly after does not break the page', async ({ page }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await page.goto('/jobs?posted=any');
        await expect(
            page
                .locator('[data-job-row]')
                .or(page.getByText(/No roles match/i))
                .or(page.getByText(/being connected/i))
                .or(page.getByText(/temporarily unavailable/i))
                .first(),
        ).toBeVisible({ timeout: 20_000 });

        await page.reload();
        await expect(
            page
                .locator('[data-job-row]')
                .or(page.getByText(/No roles match/i))
                .or(page.getByText(/being connected/i))
                .or(page.getByText(/temporarily unavailable/i))
                .first(),
        ).toBeVisible({ timeout: 20_000 });

        expect(pageErrors).toEqual([]);
    });
});

test.describe('saved searches — guest path', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                window.localStorage.clear();
            } catch {
                /* private mode / storage disabled */
            }
        });
    });

    /**
     * A query makes `canSaveSearch` true (page.tsx: query text OR an active
     * filter OR fit/sort/board) without touching any filter default this
     * suite doesn't care about. Guest save goes straight through the
     * existing localStorage broker (SavedSearchesPanel's `commitSave`,
     * signed-out branch) — no network/auth involved.
     */
    test('saving a search adds it to the saved-search list', async ({ page }) => {
        await page.goto('/jobs?q=engineer&posted=any');
        await expect(page.getByPlaceholder(/Job title/i)).toHaveValue('engineer');

        const trigger = page.getByTestId('save-search-trigger');
        await expect(trigger).toBeVisible();
        await trigger.click();

        const nameInput = page.getByTestId('save-search-name');
        await expect(nameInput).toBeVisible();
        await nameInput.fill('My engineer search');

        await page.getByTestId('save-search-commit').click();

        const item = page.getByTestId('saved-search-item').filter({ hasText: 'My engineer search' });
        await expect(item).toBeVisible();
    });
});
