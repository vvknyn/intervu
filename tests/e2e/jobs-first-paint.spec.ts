import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-FIRST-PAINT — /jobs must never paint a layout it will replace.
 *
 * The defect this pins: résumé presence is a TRI-STATE (true / false / not yet
 * answered), and two separate seams used to collapse it to a boolean, so
 * "not yet answered" silently rendered as "no résumé" — the full Search SERP —
 * which was then torn down and replaced by For-you once the real answer landed.
 *
 * Reproducing it needs no credentials. `/api/auth/session` is an ordinary GET
 * route, so delaying it widens the exact window where the page knows a user
 * MIGHT be signed in but has not been told yet. Everything asserted below
 * happens inside that widened window.
 */

// Real key: `LAST_JOBS_HOME_VIEW_KEY` in src/lib/jobs/for-you/last-home-view.ts.
// `jobs.resumeOnFile.hint.v1` (the previous value here) is read by nothing in
// src/ — seeding it was a no-op, so TC-PAINT-001 passed vacuously regardless
// of whether the optimistic-render path worked. The page's own gate,
// `resolveJobsHomeView` (src/lib/jobs/for-you/home-view.ts), only ever reads
// this key while résumé presence is still unresolved (`resumeOnFile === null`)
// and only special-cases the literal string `"for-you"` — never `"search"` —
// as the signal that lets it render optimistically instead of sitting in
// `"pending"`.
const HINT_KEY = 'intervu.jobs.homeView';
const AUTH_DELAY_MS = 800;

/** Search-only chrome. None of it may paint while presence is unresolved. */
const SEARCH_CHROME = [
    'search-live-count',
    'jobs-toolbar',
    'topbar-docked-query',
    'mobile-search-cta',
] as const;

async function delaySession(page: Page, user: object | null, delayMs = AUTH_DELAY_MS) {
    await page.route('**/api/auth/session', async (route) => {
        await new Promise((r) => setTimeout(r, delayMs));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user }),
        });
    });
}

async function seedHint(page: Page, value: 'for-you' | 'search') {
    await page.addInitScript(
        ([k, v]) => {
            try { window.localStorage.setItem(k as string, v as string); } catch { /* private mode */ }
        },
        [HINT_KEY, value],
    );
}

test.describe('JOBS-FIRST-PAINT — no layout is painted then replaced', () => {
    test('TC-PAINT-001: returning résumé user never sees Search chrome while auth is unresolved', async ({ page }) => {
        await seedHint(page, 'for-you');
        await delaySession(page, { uid: 'e2e-first-paint-uid', email: 'qa@example.com' });

        await page.goto('/jobs');

        // Sample the whole unresolved window. A single check could fall in a gap
        // between the bad paint and its correction; this cannot.
        const deadline = Date.now() + AUTH_DELAY_MS - 100;
        const seen: string[] = [];
        while (Date.now() < deadline) {
            for (const id of SEARCH_CHROME) {
                if (await page.getByTestId(id).isVisible().catch(() => false)) seen.push(id);
            }
            await page.waitForTimeout(40);
        }
        expect(seen, `search chrome painted while résumé presence was unresolved: ${[...new Set(seen)].join(', ')}`).toEqual([]);
    });

    test('TC-PAINT-002: a genuinely signed-out visitor still gets the full Search SERP', async ({ page }) => {
        // The case OTHER than the one that surfaced the bug: suppressing chrome
        // while UNKNOWN must not suppress it once the answer is a real "no".
        await seedHint(page, 'search');
        await delaySession(page, null, 150);

        await page.goto('/jobs');
        await expect(page.getByTestId('search-live-count')).toBeVisible({ timeout: 15_000 });

        // Self-validation: TC-PAINT-001 asserts these testids are ABSENT, which a
        // renamed or deleted selector would satisfy vacuously. Proving at least
        // one of them really does appear for a signed-out visitor keeps that
        // assertion honest — if this fails, 001's silence means nothing.
        const anyChromeReal = await Promise.all(
            SEARCH_CHROME.map((id) => page.getByTestId(id).count()),
        );
        expect(
            anyChromeReal.some((n) => n > 0),
            `none of the SEARCH_CHROME testids exist any more (${SEARCH_CHROME.join(', ')}) — TC-PAINT-001 would pass vacuously`,
        ).toBe(true);
    });

    test('TC-PAINT-003: a cold visitor with no cached hint settles without flipping layouts', async ({ page }) => {
        // No seeded hint at all — the true first-ever visit.
        await delaySession(page, null, 400);
        await page.goto('/jobs');

        const forYou = page.getByTestId('for-you-home');
        const serp = page.getByTestId('search-live-count');
        await expect(forYou.or(serp).first()).toBeVisible({ timeout: 15_000 });

        // Whichever settled, it must still be the one showing a beat later —
        // a layout that changes identity after settling is the defect.
        const settledForYou = await forYou.isVisible().catch(() => false);
        await page.waitForTimeout(1500);
        expect(await forYou.isVisible().catch(() => false)).toBe(settledForYou);
    });
});
