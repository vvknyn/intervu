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
 *
 * DETECTION IS STRUCTURAL, NOT AN ENUMERATION. An earlier version of this
 * spec listed four Search-only testids and asserted their absence — that
 * mechanism is the bug class it's meant to catch: it can only ever see a
 * flash that happens to use one of the four named ids, and the guest hero
 * that actually flashed on prod (a full-page Search view, not the toolbar
 * these ids belong to) has none of them, so the spec passed vacuously.
 * Detection here instead walks every element under the page's one
 * `<main id="main">` landmark (src/app/layout.tsx:209) and flags the first
 * one — outside the For-you root and its one allowed neutral loading shell —
 * that is an interactive surface (a form control, button, link, or an
 * ARIA searchbox/combobox/listbox/tab) or a heading (h1–h3). It does not
 * matter what that element is called or which view it belongs to: any
 * future redesign of Search, or any other competing view, is covered by
 * construction. Ported from the generic detector proven against prod in
 * scratchpad/prod-verify/verify-prod.mjs, narrowed from "paints anything at
 * all" to "is an interactive/heading surface" so the Suspense fallback's
 * non-interactive "Loading jobs…" line (src/app/jobs/page.tsx JobsLoading,
 * a spinner + a `<p>`) is never mistaken for a competing view.
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

// ForYouHome.tsx renders one of these two roots — never both. Absence of a
// competing surface alone can't tell "resolved to for-you" apart from "still
// pending": neither state shows a competing view, so a spec that only checks
// for a flash's absence would pass identically whether the optimistic
// `lastHomeView` signal actually engaged or the page just sat in "pending".
const FOR_YOU_HOME = 'for-you-home';
const FOR_YOU_HOME_PENDING = 'for-you-home-pending';

type CompetingSurface = { tag: string; testid: string | null; text: string };
type MainSample = { mainFound: boolean; forYouLaidOut: boolean; competing: CompetingSurface | null };

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

// Runs entirely inside the page (page.evaluate serializes this closure — no
// access to outer scope). Walks every element under `<main>`, outside the
// two excluded roots, and reports the first one that is an interactive
// surface or heading. See the file-header comment for why this predicate
// (not an enumeration of Search's own testids) is the fix.
function sampleMainForCompetingView({ forYouId, shellId }: { forYouId: string; shellId: string }): MainSample {
    function isVisibleBox(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        // A box this small (<=4px either dimension) is the standard visually-
        // hidden/sr-only technique (skip links etc.) — a size floor, not a
        // fact about this app's markup.
        if (rect.width <= 4 || rect.height <= 4) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return false;
        if (parseFloat(cs.opacity || '1') === 0) return false;
        return true;
    }

    const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'H1', 'H2', 'H3']);
    const INTERACTIVE_ROLES = new Set(['button', 'link', 'searchbox', 'combobox', 'listbox', 'tab']);

    function isCompetingSurface(el: Element): boolean {
        if (!isVisibleBox(el)) return false;
        if (el.tagName === 'A' && el.hasAttribute('href')) return true;
        if (INTERACTIVE_TAGS.has(el.tagName)) return true;
        const role = el.getAttribute('role');
        return !!role && INTERACTIVE_ROLES.has(role);
    }

    const main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return { mainFound: false, forYouLaidOut: false, competing: null };

    const forYouEl = main.querySelector(`[data-testid="${forYouId}"]`);
    const shellEl = main.querySelector(`[data-testid="${shellId}"]`);
    const excludes = [forYouEl, shellEl].filter((e): e is Element => !!e);
    const forYouLaidOut = !!forYouEl && isVisibleBox(forYouEl);

    let hit: Element | null = null;
    const stack: Element[] = [main];
    while (stack.length) {
        const el = stack.pop() as Element;
        if (excludes.some((ex) => ex === el || ex.contains(el))) continue;
        if (el !== main && isCompetingSurface(el)) { hit = el; break; }
        for (const child of Array.from(el.children)) stack.push(child);
    }

    return {
        mainFound: true,
        forYouLaidOut,
        competing: hit
            ? { tag: hit.tagName, testid: hit.getAttribute('data-testid'), text: (hit.textContent || '').trim().slice(0, 120) }
            : null,
    };
}

async function sampleMain(page: Page): Promise<MainSample> {
    return page
        .evaluate(sampleMainForCompetingView, { forYouId: FOR_YOU_HOME, shellId: FOR_YOU_HOME_PENDING })
        .catch(() => ({ mainFound: false, forYouLaidOut: false, competing: null }));
}

// Positive control (skill: probes-need-negative-controls). Proves the walk
// above can actually detect PRESENCE of a competing surface, independent of
// the app's current bug state, so an absence claim from a clean sample
// series can never pass vacuously against a detector that's blind — e.g.
// after a markup change that removes the `<main id="main">` id, or a typo
// in the excluded testids.
async function competingSurfaceSelfTest(page: Page) {
    const injected = await page
        .evaluate(() => {
            const main = document.querySelector('main#main') || document.querySelector('main') || document.body;
            const probe = document.createElement('button');
            probe.type = 'button';
            probe.setAttribute('data-first-paint-selftest', '1');
            probe.textContent = 'first-paint-spec self-test probe';
            main.appendChild(probe);
            return true;
        })
        .catch(() => false);
    const sample = await sampleMain(page);
    await page
        .evaluate(() => document.querySelector('[data-first-paint-selftest]')?.remove())
        .catch(() => {});
    return { injected, detected: !!sample.competing, sample };
}

test.describe('JOBS-FIRST-PAINT — no layout is painted then replaced', () => {
    test('TC-PAINT-001: returning résumé user never sees a competing view while auth is unresolved', async ({ page }) => {
        await seedHint(page, 'for-you');
        await delaySession(page, { uid: 'e2e-first-paint-uid', email: 'qa@example.com' });

        await page.goto('/jobs');

        const selfTest = await competingSurfaceSelfTest(page);
        expect(
            selfTest.detected,
            `structural detector failed to see its own injected probe — it is blind, so this test's absence claim below would be meaningless: ${JSON.stringify(selfTest)}`,
        ).toBe(true);

        // The optimistic root must mount well inside the auth-delay window —
        // it does not wait for résumé presence to resolve. A page stuck on
        // the pending placeholder (dead/missing hint) never satisfies this.
        await expect(page.getByTestId(FOR_YOU_HOME)).toBeVisible({ timeout: AUTH_DELAY_MS - 200 });

        // Sample the whole unresolved window. A single check could fall in a gap
        // between the bad paint and its correction; this cannot.
        const deadline = Date.now() + AUTH_DELAY_MS - 100;
        const sightings: CompetingSurface[] = [];
        const pendingSeen: string[] = [];
        while (Date.now() < deadline) {
            const sample = await sampleMain(page);
            if (sample.competing) sightings.push(sample.competing);
            if (await page.getByTestId(FOR_YOU_HOME_PENDING).isVisible().catch(() => false)) {
                pendingSeen.push(FOR_YOU_HOME_PENDING);
            }
            await page.waitForTimeout(40);
        }
        expect(
            sightings,
            `a competing view (interactive/heading surface) painted inside <main> while résumé presence was unresolved: ${JSON.stringify(sightings)}`,
        ).toEqual([]);
        expect(
            pendingSeen,
            'fell back to the pending placeholder instead of resolving optimistically to for-you',
        ).toEqual([]);
    });

    test('TC-PAINT-002: a genuinely signed-out visitor still gets a real Search view, and the detector actually sees it', async ({ page }) => {
        // The case OTHER than the one that surfaced the bug: suppressing a
        // competing view while UNKNOWN must not suppress it once the answer
        // is a real "no".
        await seedHint(page, 'search');
        await delaySession(page, null, 150);

        await page.goto('/jobs');
        await expect(page.getByTestId('search-live-count')).toBeVisible({ timeout: 15_000 });

        // Self-validation: TC-PAINT-001 asserts the structural sample is
        // empty, which a broken/blinded detector would satisfy vacuously.
        // Proving the SAME detector finds a competing surface on a page that
        // is genuinely, legitimately showing Search keeps that assertion
        // honest — if this fails, 001's silence means nothing.
        const sample = await sampleMain(page);
        expect(
            sample.competing,
            'structural detector found no interactive/heading element in <main> on a real Search view — TC-PAINT-001 would pass vacuously',
        ).not.toBeNull();
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
