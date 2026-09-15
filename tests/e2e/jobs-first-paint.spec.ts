import { test, expect, type Page, type Request } from '@playwright/test';

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
 * only an actual TEXT-ENTRY control counts — `textarea`/`select`,
 * `role="searchbox"|"combobox"`, or an `<input>` with no `type` or a
 * text-like one (text/search/email/url/tel/number) — never a checkbox,
 * radio, range, or other non-text input, and never the header's own nav
 * links or buttons. Those render on every /jobs visit regardless of home
 * view and are legitimate shared chrome, not a competing view.
 *
 * SAMPLING IS EVENT-TIED, NOT CLOCK-TIED. Every test below samples from
 * `page.goto(..., { waitUntil: 'commit' })` — the earliest checkpoint
 * Playwright offers — through the real request(s) that settle the page's
 * unresolved inputs: `/api/auth/session` always (settles `authReady`), plus
 * TC-PAINT-004's own Server Action round trip when a signed-in user's
 * résumé presence also depends on the network. The loop's exit condition is
 * each of those requests' own `requestfinished` event, never `networkidle`
 * (which hangs well past budget for a signed-in fixture) and never a
 * `Date.now()` deadline. A request finishing only proves the NETWORK
 * settled, not that React has painted the result — `pollForSample` below
 * covers that gap for every "what does the page show right now" assertion,
 * bounded only by Playwright's own expect timeout, the same outer bound
 * every `toBeVisible({ timeout })` call here already relies on.
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
// This is the "local résumé" path the fix commit (12476231, "stop For you
// Search flash") names alongside the returning-user case, whose résumé
// lives only on the server; TC-PAINT-004 below covers that second path by
// actually intercepting `hasUsableResumeOnFile`'s (src/actions/resume.ts)
// real Server Action round trip — a POST to the current URL carrying a
// `Next-Action` header, not a named JSON path, but still a real
// request/response cycle `page.route` can match structurally and rewrite,
// same as every other fixture in this file.
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

// Fabricated user only (no real account) — same fictitious person as
// SYNTHETIC_RESUME, now on the "résumé already saved to their account"
// side of the split this spec covers instead of the "local device" side.
const FAKE_SERVER_RESUME_USER = {
    uid: 'e2e-first-paint-server-resume-uid',
    email: 'sam.rivera.dev@example.com',
    displayName: 'Sam Rivera',
};

// Intercepts the real `hasUsableResumeOnFile` Server Action (src/actions/
// resume.ts:21) — a POST to the current page URL carrying a `Next-Action`
// header, per Next.js's Server Actions wire protocol — and flips its one
// boolean field in the real response body. The request/response cycle is
// real; only the answer is invented, same as `delaySession` inventing the
// session endpoint's answer. Returns a settle-check tied to the ACTUAL
// resume-presence response landing (identified by its own `"hasResume"`
// field), not merely "some Server Action POST finished" — /jobs fires more
// than one Server Action on mount (e.g. usePursuits), and a settle check
// keyed on the header alone would race whichever one happens to land first.
async function forceServerResumePresent(page: Page): Promise<(req: Request) => boolean> {
    let resumeResponseSettled = false;
    await page.route(
        (url) => url.pathname === '/jobs',
        async (route) => {
            const req = route.request();
            if (req.method() !== 'POST' || !req.headers()['next-action']) {
                await route.continue();
                return;
            }
            const response = await route.fetch();
            const original = await response.text();
            const body = original.replace('"hasResume":false', '"hasResume":true');
            if (original.includes('"hasResume"')) resumeResponseSettled = true;
            await route.fulfill({ response, body });
        },
    );
    return () => resumeResponseSettled;
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
    const TEXT_ENTRY_ROLES = new Set(['searchbox', 'combobox']);
    // Deliberately narrower than "is this an <input>": a checkbox, radio,
    // range, color, file, or submit/button/reset/hidden/image input is not
    // a text-entry control a visitor could type into, so it must not count
    // as a competing header surface.
    const TEXT_ENTRY_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);

    function isCompetingSurface(el: Element): boolean {
        if (!isVisibleBox(el)) return false;
        if (el.tagName === 'A' && el.hasAttribute('href')) return true;
        if (INTERACTIVE_TAGS.has(el.tagName)) return true;
        const role = el.getAttribute('role');
        return !!role && INTERACTIVE_ROLES.has(role);
    }

    function isTextEntryControl(el: Element): boolean {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
        if (el.tagName === 'INPUT') {
            const type = el.getAttribute('type');
            return type === null || TEXT_ENTRY_INPUT_TYPES.has(type.toLowerCase());
        }
        const role = el.getAttribute('role');
        return !!role && TEXT_ENTRY_ROLES.has(role);
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
    const candidateEls = document.body.querySelectorAll('input, textarea, select, [role="searchbox"], [role="combobox"]');
    for (const el of Array.from(candidateEls)) {
        if (main && (main === el || main.contains(el))) continue;
        if (isTextEntryControl(el) && isVisibleBox(el)) { headerHit = el; break; }
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
// exactly as before, navigates at `commit`, and samples continuously until
// EVERY one of the page's unresolved network inputs has its own
// `requestfinished` event — `/api/auth/session` always, plus whatever
// `extraSettleChecks` a fixture needs (TC-PAINT-004 adds its Server Action
// round trip) — then takes one more sample right after the last one lands.
// Never `networkidle`: a signed-in fixture never actually goes idle within
// budget, so this file has no networkidle wait at all — see `pollForSample`
// for how the "what does the page show right now" assertions cover that gap
// instead.
async function gotoAndSampleUntilSettled(
    page: Page,
    { user = null, extraSettleChecks = [] }: { user?: object | null; extraSettleChecks?: Array<(req: Request) => boolean> } = {},
): Promise<{ samples: PageSample[] }> {
    await delaySession(page, user, AUTH_DELAY_MS);
    const settleChecks: Array<(req: Request) => boolean> = [
        (req) => req.url().includes('/api/auth/session'),
        ...extraSettleChecks,
    ];
    const settledFlags = settleChecks.map(() => false);
    page.on('requestfinished', (req) => {
        settleChecks.forEach((check, i) => {
            if (!settledFlags[i] && check(req)) settledFlags[i] = true;
        });
    });

    await page.goto('/jobs', { waitUntil: 'commit' });

    const samples: PageSample[] = [];
    while (settledFlags.some((settled) => !settled)) {
        samples.push(await sampleMain(page));
        await page.waitForTimeout(20);
    }
    samples.push(await sampleMain(page)); // one more right after the last input landed

    return { samples };
}

// Polls the live DOM until `predicate` holds, returning the sample that
// satisfied it. The settle checks above only prove a REQUEST finished, not
// that React has painted its result — under CPU throttling (this file's own
// throttled proof run) rendering can lag well behind network completion, so
// a single sample taken right after settling can read a stale DOM. Bounded
// only by Playwright's own expect timeout, never `Date.now()` — the same
// idiom as every `toBeVisible({ timeout })` call in this file.
async function pollForSample(page: Page, predicate: (s: PageSample) => boolean): Promise<PageSample> {
    let last!: PageSample;
    await expect.poll(async () => {
        last = await sampleMain(page);
        return predicate(last);
    }).toBe(true);
    return last;
}

test.describe('JOBS-FIRST-PAINT — no layout is painted then replaced', () => {
    test('TC-PAINT-001: a guest with a résumé cached locally never sees a competing Search/header view before For-you settles', async ({ page }) => {
        await seedGuestResume(page);

        const { samples } = await gotoAndSampleUntilSettled(page);

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

        // No flip: poll until the page is actually showing the settled
        // state — a single sample taken right after the network settles can
        // read a stale DOM under load (see pollForSample's doc comment).
        const settled = await pollForSample(page, (s) => s.forYouLaidOut && !s.competing && !s.headerTextEntry);
        expect(settled.competing).toBeNull();
        expect(settled.headerTextEntry).toBeNull();
        expect(settled.forYouLaidOut, 'flipped away from For-you once presence fully settled').toBe(true);
    });

    test('TC-PAINT-002: a genuinely signed-out visitor with a search hint still gets a real Search view, and the detector actually sees it', async ({ page }) => {
        // The case OTHER than the one that surfaced the bug: suppressing a
        // competing view while UNKNOWN must not suppress it once the answer
        // is a real "no".
        await seedHint(page, 'search');
        await gotoAndSampleUntilSettled(page);

        await expect(page.getByTestId('search-live-count')).toBeVisible({ timeout: 15_000 });

        // Self-validation, positive control: proving the SAME detector finds
        // a competing surface on a page that is genuinely, legitimately
        // showing Search keeps TC-PAINT-001's absence claim honest — if this
        // fails, that silence means nothing. Polled AFTER the toBeVisible
        // above, never from a snapshot taken before Search was confirmed
        // visible — under CPU throttling React can still be painting when
        // the network settles (see pollForSample's doc comment).
        const settled = await pollForSample(page, (s) => s.competing !== null);
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

    test('TC-PAINT-004: a returning signed-in visitor whose résumé lives only on the server never sees a competing Search/header view before presence settles', async ({ page }) => {
        // The case a mutant reverting the `authReady` handling (page.tsx
        // ~1962-1974 — `useResumePresence(uid)` without `authReady`,
        // `resumeOnFile = hasUsableResume || resumeKnownOnServer`) escapes:
        // no local résumé (`hasUsableResume` is false), so the ONLY path to
        // `resumeOnFile === true` is the real server round trip, gated on
        // `authReady`. `seedHint('for-you')` makes the fixed code render
        // For-you optimistically from the start; the mutant instead reads a
        // premature uid=null tick as a known "no résumé" and paints Search
        // before the real answer lands.
        await seedHint(page, 'for-you');
        const resumeActionSettled = await forceServerResumePresent(page);

        const { samples } = await gotoAndSampleUntilSettled(page, {
            user: FAKE_SERVER_RESUME_USER,
            extraSettleChecks: [resumeActionSettled],
        });

        // /jobs fires more than one Server Action on mount (e.g.
        // usePursuits); our route only needs to have seen the résumé one
        // settle, but another matching in-flight `route.fetch()` can still
        // be pending here and would otherwise abort loudly when the test's
        // browser context closes. Nothing below needs the route anymore.
        await page.unrouteAll({ behavior: 'ignoreErrors' });

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
            `a competing view painted inside <main> for a returning signed-in user before server résumé presence settled: ${JSON.stringify(mainSightings)}`,
        ).toEqual([]);
        const headerSightings = samples.filter((s) => s.headerTextEntry).map((s) => s.headerTextEntry);
        expect(
            headerSightings,
            `a text-entry control painted in the header before server résumé presence settled: ${JSON.stringify(headerSightings)}`,
        ).toEqual([]);

        expect(samples.some((s) => s.forYouLaidOut), 'For-you root never laid out at all during the sampled window').toBe(true);

        // No flip: poll until the page is actually showing the settled
        // state, same reasoning as TC-PAINT-001.
        const settled = await pollForSample(page, (s) => s.forYouLaidOut && !s.competing && !s.headerTextEntry);
        expect(settled.competing).toBeNull();
        expect(settled.headerTextEntry).toBeNull();
        expect(settled.forYouLaidOut, 'flipped away from For-you once server résumé presence fully settled').toBe(true);
    });
});
