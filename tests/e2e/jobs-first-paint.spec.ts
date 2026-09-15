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
 *
 * HEADER COVERAGE. TopBar docks its own search field (src/components/layout/
 * TopBar.tsx) OUTSIDE `<main>` (layout.tsx: TopBar at line 202, `<main>` at
 * 209 — siblings, not parent/child), and `headerDockActive` gates it on the
 * exact same résumé-presence race. A separate, narrower walk covers this:
 * only an actual text-entry control (`input`/`textarea`/`select`, or
 * `role="searchbox"|"combobox"`) counts, never the header's own nav links or
 * buttons — those render on every /jobs visit regardless of home view and
 * are legitimate shared chrome, not a competing view.
 *
 * SAMPLING IS EVENT-TIED, NOT CLOCK-TIED. Every test below samples from
 * `page.goto(..., { waitUntil: 'commit' })` — the earliest checkpoint
 * Playwright offers — through the real `/api/auth/session` round trip that
 * settles `authReady`, the last input `resolveJobsHomeView` depends on for
 * a guest whose résumé state is already synchronous. The loop's exit
 * condition is that request's own `requestfinished` event; there is no
 * `Date.now()` deadline anywhere in this file. Playwright's own per-test
 * timeout is the only outer bound, exactly as it is for every other awaited
 * call here.
 */

// Real key: `LAST_JOBS_HOME_VIEW_KEY` in src/lib/jobs/for-you/last-home-view.ts.
// The page's own gate, `resolveJobsHomeView` (src/lib/jobs/for-you/home-view.ts),
// only ever reads this key while résumé presence is still unresolved
// (`resumeOnFile === null`) and only special-cases the literal string
// `"for-you"` — never `"search"` — as the signal that lets it render
// optimistically instead of sitting in `"pending"`.
const HINT_KEY = 'intervu.jobs.homeView';
const AUTH_DELAY_MS = 800;

// ForYouHome.tsx renders one of these two roots — never both.
const FOR_YOU_HOME = 'for-you-home';
const FOR_YOU_HOME_PENDING = 'for-you-home-pending';

// Real product keys: src/lib/local-ai/flag.ts and src/lib/local-ai/resume-storage.ts.
const LOCAL_AI_ENABLED_KEY = 'velai.localAi.enabled';
const LOCAL_AI_RESUME_KEY = 'velai.localAi.resume';

// Fabricated data only (no real person) — reused verbatim from the fixture
// already proven against real prod by scratchpad/prod-verify/verify-prod.mjs's
// `RESUME`, which this exact `readLocalAiResume()` / `resumeIsUsable()` pair
// (src/lib/local-ai/resume-storage.ts, src/lib/resume/resume-usable.ts)
// already accepts as usable.
const SYNTHETIC_RESUME = {
    profile: {
        name: 'Sam Rivera',
        profession: 'Senior Software Engineer',
        yearsOfExperience: 7,
        location: 'San Francisco, CA',
        email: 'sam.rivera.dev@example.com',
        phone: '555-010-1234',
        linkedin: 'linkedin.com/in/samrivera-dev',
        website: '',
    },
    experience: [
        {
            id: 'exp1',
            company: 'Nimbus Data',
            role: 'Senior Software Engineer',
            dates: '2021 - Present',
            description:
                'Built and scaled backend services in TypeScript/Node and Go. Led migration to a microservices architecture on AWS (ECS, Lambda, RDS). Mentored 3 junior engineers.',
        },
        {
            id: 'exp2',
            company: 'Fenwick Labs',
            role: 'Software Engineer',
            dates: '2018 - 2021',
            description:
                'Developed React/TypeScript front-end features for a B2B SaaS product. Owned CI/CD pipeline (GitHub Actions, Docker).',
        },
    ],
    competencies: [
        { category: 'Languages', skills: ['TypeScript', 'JavaScript', 'Go', 'Python', 'SQL'] },
        { category: 'Frameworks', skills: ['React', 'Node.js', 'Next.js', 'Express'] },
        { category: 'Cloud/Infra', skills: ['AWS', 'Docker', 'Kubernetes', 'Terraform'] },
    ],
    education: [{ id: 'edu1', degree: 'B.S. Computer Science', institution: 'State University', year: '2018' }],
    generatedSummary:
        'Senior software engineer with 7 years of experience building scalable backend and full-stack systems in TypeScript, Go, and AWS.',
};

type CompetingSurface = { tag: string; testid: string | null; text: string };
type PageSample = {
    mainFound: boolean;
    forYouLaidOut: boolean;
    /** First interactive/heading surface inside <main>, outside the For-you roots. */
    competing: CompetingSurface | null;
    /** First visible text-entry control outside <main> (header/chrome). */
    headerTextEntry: CompetingSurface | null;
};

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

// Real mechanism: a `useLayoutEffect` in src/app/jobs/page.tsx (runs
// synchronously before the browser paints) hydrates this into `resume`
// state for a signed-out guest, which is what lets `resumeOnFile` resolve
// `true` — and For-you render — without waiting on any network round trip.
// This is the "or local résumé can answer" path the fix commit (12476231,
// "stop For you Search flash") names alongside the returning-user case;
// faking the returning-user case itself would mean faking
// `hasUsableResumeOnFile` (src/actions/resume.ts), a real `"use server"`
// Server Action over the RSC Flight wire protocol, not a plain JSON
// endpoint `page.route` can intercept.
async function seedGuestResume(page: Page) {
    await page.addInitScript(
        ([enabledKey, resumeKey, resume]) => {
            try {
                window.localStorage.setItem(enabledKey as string, '1');
                window.localStorage.setItem(
                    resumeKey as string,
                    JSON.stringify({ data: resume, updatedAt: new Date().toISOString(), sourceLabel: 'e2e-first-paint-synthetic' }),
                );
            } catch { /* private mode */ }
        },
        [LOCAL_AI_ENABLED_KEY, LOCAL_AI_RESUME_KEY, SYNTHETIC_RESUME],
    );
}

// Runs entirely inside the page (page.evaluate serializes this closure — no
// access to outer scope).
function sampleMainForCompetingView({ forYouId, shellId }: { forYouId: string; shellId: string }): PageSample {
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
    const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
    const TEXT_ENTRY_ROLES = new Set(['searchbox', 'combobox']);

    function isCompetingSurface(el: Element): boolean {
        if (!isVisibleBox(el)) return false;
        if (el.tagName === 'A' && el.hasAttribute('href')) return true;
        if (INTERACTIVE_TAGS.has(el.tagName)) return true;
        const role = el.getAttribute('role');
        return !!role && INTERACTIVE_ROLES.has(role);
    }

    function describe(el: Element): CompetingSurface {
        return { tag: el.tagName, testid: el.getAttribute('data-testid'), text: (el.textContent || '').trim().slice(0, 120) };
    }

    const main = document.querySelector('main#main') || document.querySelector('main');

    // Header/chrome coverage — deliberately narrower than the in-main
    // predicate. Shared nav links/buttons render on every /jobs visit
    // regardless of home view and must stay allowed; only a real text-entry
    // control counts as a competing surface out here.
    let headerHit: Element | null = null;
    const textEntryEls = document.body.querySelectorAll('input, textarea, select, [role="searchbox"], [role="combobox"]');
    for (const el of Array.from(textEntryEls)) {
        if (main && (main === el || main.contains(el))) continue;
        const role = el.getAttribute('role');
        const isTextEntry = TEXT_ENTRY_TAGS.has(el.tagName) || (!!role && TEXT_ENTRY_ROLES.has(role));
        if (isTextEntry && isVisibleBox(el)) { headerHit = el; break; }
    }
    const headerTextEntry = headerHit ? describe(headerHit) : null;

    if (!main) return { mainFound: false, forYouLaidOut: false, competing: null, headerTextEntry };

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

    return { mainFound: true, forYouLaidOut, competing: hit ? describe(hit) : null, headerTextEntry };
}

async function sampleMain(page: Page): Promise<PageSample> {
    return page
        .evaluate(sampleMainForCompetingView, { forYouId: FOR_YOU_HOME, shellId: FOR_YOU_HOME_PENDING })
        .catch(() => ({ mainFound: false, forYouLaidOut: false, competing: null, headerTextEntry: null }));
}

// Positive control (skill: probes-need-negative-controls). Proves both
// channels above can actually detect PRESENCE of a competing surface,
// independent of the app's current bug state, so an absence claim from a
// clean sample series can never pass vacuously against a detector that's
// blind — e.g. after a markup change removes the `<main id="main">` id, or a
// typo in the excluded testids. Runs AFTER the sampling loop below: at
// `waitUntil: 'commit'`, `<main>` may not exist yet to inject a probe into.
async function competingSurfaceSelfTest(page: Page) {
    const injected = await page
        .evaluate(() => {
            const main = document.querySelector('main#main') || document.querySelector('main') || document.body;
            const probe = document.createElement('button');
            probe.type = 'button';
            probe.setAttribute('data-first-paint-selftest', '1');
            probe.textContent = 'first-paint-spec self-test probe';
            main.appendChild(probe);

            // Appended directly to <body> — never inside <main>'s subtree
            // regardless of DOM depth — to prove the header channel too.
            const headerProbe = document.createElement('input');
            headerProbe.type = 'text';
            headerProbe.setAttribute('data-first-paint-header-selftest', '1');
            document.body.appendChild(headerProbe);
            return true;
        })
        .catch(() => false);
    const sample = await sampleMain(page);
    await page
        .evaluate(() => {
            document.querySelector('[data-first-paint-selftest]')?.remove();
            document.querySelector('[data-first-paint-header-selftest]')?.remove();
        })
        .catch(() => {});
    return { injected, detected: !!sample.competing, headerDetected: !!sample.headerTextEntry, sample };
}

// Single navigation+sampling chokepoint shared by every test below (single
// source of truth for "no absolute deadlines"): delays `/api/auth/session`
// exactly as before, but now navigates at `commit` and samples continuously
// until that request's own `requestfinished` event fires — never a clock —
// then takes one more sample, waits for real network idle, and samples the
// settled state.
async function gotoAndSampleUntilSettled(page: Page, user: object | null = null): Promise<{ samples: PageSample[]; settled: PageSample }> {
    await delaySession(page, user, AUTH_DELAY_MS);
    let sessionSettled = false;
    page.on('requestfinished', (req) => {
        if (req.url().includes('/api/auth/session')) sessionSettled = true;
    });

    await page.goto('/jobs', { waitUntil: 'commit' });

    const samples: PageSample[] = [];
    while (!sessionSettled) {
        samples.push(await sampleMain(page));
        await page.waitForTimeout(20);
    }
    samples.push(await sampleMain(page)); // one more right after the request lands
    await page.waitForLoadState('networkidle');
    const settled = await sampleMain(page); // "no flip" — past every unresolved input

    return { samples, settled };
}

test.describe('JOBS-FIRST-PAINT — no layout is painted then replaced', () => {
    test('TC-PAINT-001: a guest with a résumé cached locally never sees a competing Search/header view before For-you settles', async ({ page }) => {
        await seedGuestResume(page);

        const { samples, settled } = await gotoAndSampleUntilSettled(page);

        // Run after sampling: <main> may not exist at `commit`.
        const selfTest = await competingSurfaceSelfTest(page);
        expect(
            selfTest.detected,
            `structural in-main detector failed to see its own injected probe — it is blind, so the absence claim below would be meaningless: ${JSON.stringify(selfTest)}`,
        ).toBe(true);
        expect(
            selfTest.headerDetected,
            `structural header detector failed to see its own injected probe — it is blind, so the absence claim below would be meaningless: ${JSON.stringify(selfTest)}`,
        ).toBe(true);

        const mainSightings = samples.filter((s) => s.competing).map((s) => s.competing);
        expect(
            mainSightings,
            `a competing view (interactive/heading surface) painted inside <main> before résumé presence settled: ${JSON.stringify(mainSightings)}`,
        ).toEqual([]);
        const headerSightings = samples.filter((s) => s.headerTextEntry).map((s) => s.headerTextEntry);
        expect(
            headerSightings,
            `a text-entry control painted in the header before résumé presence settled: ${JSON.stringify(headerSightings)}`,
        ).toEqual([]);

        // For-you visibility derived from the same samples — never a separate
        // toBeVisible(timeout) call — and asserted only after the absence
        // claims above, so a run that never actually reached For-you can't
        // pass by having nothing to flash from.
        expect(samples.some((s) => s.forYouLaidOut), 'For-you root never laid out at all during the sampled window').toBe(true);

        // No flip: still For-you, still no competing surface, after the
        // presence-settling request finished AND the network went idle.
        expect(settled.competing).toBeNull();
        expect(settled.headerTextEntry).toBeNull();
        expect(settled.forYouLaidOut, 'flipped away from For-you once presence fully settled').toBe(true);
    });

    test('TC-PAINT-002: a genuinely signed-out visitor with a search hint still gets a real Search view, and the detector actually sees it', async ({ page }) => {
        // The case OTHER than the one that surfaced the bug: suppressing a
        // competing view while UNKNOWN must not suppress it once the answer
        // is a real "no".
        await seedHint(page, 'search');
        const { settled } = await gotoAndSampleUntilSettled(page);

        await expect(page.getByTestId('search-live-count')).toBeVisible({ timeout: 15_000 });

        // Self-validation, positive control: proving the SAME detector finds
        // a competing surface on a page that is genuinely, legitimately
        // showing Search keeps TC-PAINT-001's absence claim honest — if this
        // fails, that silence means nothing.
        expect(
            settled.competing,
            'structural detector found no interactive/heading element in <main> on a real Search view — TC-PAINT-001 would pass vacuously',
        ).not.toBeNull();
    });

    test('TC-PAINT-003: a cold visitor with no résumé and no hint never paints the For-you root before Search settles', async ({ page }) => {
        // The inverse of TC-PAINT-001's class: suppressing Search chrome
        // while résumé presence is unknown must never let For-you render for
        // a visitor who has nothing — no résumé, no hint — that could ever
        // justify it.
        const { samples } = await gotoAndSampleUntilSettled(page);

        await expect(page.getByTestId('search-live-count')).toBeVisible({ timeout: 15_000 });

        expect(
            samples.some((s) => s.forYouLaidOut),
            `For-you root laid out for a visitor with no résumé and no hint: ${JSON.stringify(samples.filter((s) => s.forYouLaidOut))}`,
        ).toBe(false);
    });
});
