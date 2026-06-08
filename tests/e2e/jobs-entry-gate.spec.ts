import { test, expect, type Page } from '@playwright/test';

/**
 * TEST GROUP: JOBS-GATE - /jobs Resume-Gated Entry Tests
 *
 * Covers the candidate-first entry gate on /jobs (JobsEntryGate.tsx + the
 * entry state machine in app/jobs/page.tsx). Instead of auto-loading the
 * newest roles, an anonymous visitor lands on the ASK screen ("Tailor jobs to
 * your resume?"). From there:
 *   - "Upload résumé"        → login-gated → AuthPopover dialog
 *   - "No, I'll search"      → search-only screen (prompt, no auto results)
 *   - "or browse all live roles" → BROWSE mode (results OR a "being connected"
 *                                  empty state when Meilisearch is unconfigured)
 *
 * The active mode persists in localStorage under `intervu.jobs.entry`
 * ({"mode":"search","q":"",...}). Every test clears that key (via an init
 * script that runs before any app code) so tests are order-independent and a
 * prior run can never leave us on a results screen. The CHOOSE screen requires
 * a saved, usable resume — which fetchResumeData() only returns for an
 * AUTHENTICATED user — so an anonymous visitor can never reach it.
 *
 * ENVIRONMENT TOLERANCE: the dev server here may not have the Meilisearch
 * backend configured. BROWSE therefore renders EITHER result cards OR a
 * "Job search is being connected" empty state. Tests assert the gate screens
 * are gone and a results-or-empty surface is present — never that result cards
 * exist.
 */

const ENTRY_KEY = 'intervu.jobs.entry';

/** Heading shown ONLY on the anonymous ASK screen. */
const askHeading = (page: Page) =>
    page.getByRole('heading', { name: /Tailor jobs to your resume/i });

/** Prompt shown on the search-only screen before the user types anything. */
const searchPrompt = (page: Page) =>
    page.getByRole('heading', { name: /Search for the kind of role you want/i });

/**
 * Wipe the persisted entry mode (and all of localStorage) BEFORE any app code
 * runs, so first paint resolves the gate from a clean slate rather than
 * restoring a results mode left by an earlier test/run. addInitScript fires on
 * every navigation in the context, which is exactly what we want here.
 */
async function clearEntryState(page: Page) {
    await page.addInitScript((key) => {
        try {
            window.localStorage.removeItem(key);
            window.localStorage.clear();
        } catch {
            /* private mode / disabled storage — gate just re-asks, fine */
        }
    }, ENTRY_KEY);
}

test.describe('JOBS-GATE - /jobs Resume-Gated Entry Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Default for every test: start with no persisted entry mode. Test 6
        // overrides this with its own seeding init script (init scripts stack,
        // both run, and the seed for `intervu.jobs.entry` survives clear()
        // because it is registered AFTER this one — see that test).
        await clearEntryState(page);
    });

    /**
     * TC-JOBS-GATE-001: Anonymous visit lands on the ASK screen
     *
     * The opening screen for a visitor with no Firebase session and no saved
     * resume is ASK: the "Tailor jobs to your resume?" heading plus both the
     * "Upload résumé" and "No, I'll search" actions.
     */
    test('TC-JOBS-GATE-001: Anonymous visit lands on the ASK screen', async ({ page }) => {
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        // REAL assertion: the ASK heading must render for an anonymous visitor.
        await expect(askHeading(page)).toBeVisible({ timeout: 15000 });

        // ...and both primary ASK actions must be present (exact accented /
        // apostrophe strings, matched resiliently by role + name regex).
        await expect(page.getByRole('button', { name: /Upload r/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /No, I.?ll search/i })).toBeVisible();
    });

    /**
     * TC-JOBS-GATE-002: CHOOSE screen is NOT shown to an anonymous visitor
     *
     * fetchResumeData() returns Unauthorized for anonymous users, so the gate
     * resolves to ASK — the CHOOSE cards ("Match my resume" / "Explore adjacent
     * roles") must be absent on first load.
     */
    test('TC-JOBS-GATE-002: CHOOSE screen is hidden for anonymous visitor', async ({ page }) => {
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        // Anchor on the ASK screen first so we know the gate has resolved (not
        // still in the transient `loading` spinner) before the negative checks.
        await expect(askHeading(page)).toBeVisible({ timeout: 15000 });

        // REAL negative assertions: the CHOOSE-only controls must not exist.
        await expect(page.getByRole('button', { name: /Match my resume/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Explore adjacent roles/i })).toHaveCount(0);
        // The CHOOSE heading must also be absent.
        await expect(
            page.getByRole('heading', { name: /How do you want to look/i }),
        ).toHaveCount(0);
    });

    /**
     * TC-JOBS-GATE-003: "No, I'll search" → search-only screen, no auto results
     *
     * Choosing search-only shows the "Search for the kind of role you want"
     * prompt and does NOT auto-populate a result list (empty query → prompt,
     * no fetch).
     */
    test('TC-JOBS-GATE-003: No, I\'ll search opens the search-only prompt', async ({ page }) => {
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');
        await expect(askHeading(page)).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: /No, I.?ll search/i }).click();

        // REAL assertion: the search-only prompt replaces the ASK gate.
        await expect(searchPrompt(page)).toBeVisible({ timeout: 15000 });

        // The ASK gate is gone, and nothing auto-loaded: no job rows yet. (The
        // search-only screen fetches only once a query is typed.) A job row is a
        // result card carrying the "Possible ghost job"/"No ghost signals"
        // badge text; none should be present before typing.
        await expect(askHeading(page)).toHaveCount(0);
        await expect(
            page.locator('text=/Possible ghost job|No ghost signals|Worth verifying/i'),
        ).toHaveCount(0);
    });

    /**
     * TC-JOBS-GATE-004: "Upload résumé" (anonymous) opens the auth dialog
     *
     * Upload is login-gated, so clicking it while signed-out opens the
     * AuthPopover — a Radix Dialog containing the login form (password input).
     */
    test('TC-JOBS-GATE-004: Upload résumé opens auth dialog when anonymous', async ({ page }) => {
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');
        await expect(askHeading(page)).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: /Upload r/i }).click();

        // REAL assertion: an auth surface (the dialog, or its password field)
        // becomes visible. Either selector proves the login-gate fired.
        const authSurface = page.locator('[role="dialog"], input[type="password"]');
        await expect(authSurface.first()).toBeVisible({ timeout: 15000 });
    });

    /**
     * TC-JOBS-GATE-005: "or browse all live roles" leaves the ASK gate
     *
     * Browsing switches to BROWSE mode and triggers a search. The ASK gate must
     * disappear and a results-or-empty surface must appear. Tolerant of an
     * unconfigured Meilisearch backend (which renders a "being connected" empty
     * state instead of result cards).
     */
    test('TC-JOBS-GATE-005: browse all live roles exits the gate', async ({ page }) => {
        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');
        await expect(askHeading(page)).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: /browse all live roles/i }).click();

        // REAL assertion: the ASK heading must disappear once BROWSE is active.
        await expect(askHeading(page)).toHaveCount(0, { timeout: 15000 });

        // ...and a results-or-empty surface must be present — WITHOUT requiring
        // result cards (backend may be unconfigured). Any of: the loading
        // splash, the "being connected" / "no roles" empty states, the
        // results-count line, or an actual job-row ghost badge satisfies this.
        const resultsOrEmpty = page
            .locator('text=/being connected/i')
            .or(page.locator('text=/No roles match/i'))
            .or(page.locator('text=/Finding live roles/i'))
            .or(page.locator('text=/newest first/i'))
            .or(page.locator('text=/\\d[\\d,]*\\s+roles?\\b/i'))
            .or(page.locator('text=/Possible ghost job|No ghost signals|Worth verifying/i'));
        await expect(resultsOrEmpty.first()).toBeVisible({ timeout: 15000 });
    });

    /**
     * TC-JOBS-GATE-006: Mode persistence restores search on reload
     *
     * Seeding localStorage['intervu.jobs.entry'] = {"mode":"search","q":""}
     * BEFORE navigation must restore the page directly into search (the
     * "Search for the kind of role you want" prompt), bypassing the ASK gate.
     */
    test('TC-JOBS-GATE-006: persisted search mode is restored on load', async ({ page }) => {
        // Register a SECOND init script that seeds the entry key. The
        // beforeEach init script (clear) runs first; this one runs after it, so
        // the seeded value survives into app code. Both fire before any page JS.
        await page.addInitScript((key) => {
            try {
                window.localStorage.setItem(key, JSON.stringify({ mode: 'search', q: '' }));
            } catch {
                /* storage disabled — test asserts restored state, which would then fail loudly */
            }
        }, ENTRY_KEY);

        await page.goto('/jobs');
        await page.waitForLoadState('networkidle');

        // REAL assertion: the persisted `search` mode restores straight to the
        // search-only prompt — the ASK gate is skipped entirely.
        await expect(searchPrompt(page)).toBeVisible({ timeout: 15000 });
        await expect(askHeading(page)).toHaveCount(0);
    });
});
