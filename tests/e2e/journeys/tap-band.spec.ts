import { chromium, devices, webkit, type Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * J-MOB-29: on a phone every control in the /jobs header and toolbar, and in
 * the Filters sheet, has a 44px tap band. Probes the points a thumb hits
 * (centre, and 21px above and below it) with elementFromPoint, so a control
 * whose invisible hit area is clipped by a scrolling ancestor fails. Runs in
 * both engines the phones use: Chromium (Android) and WebKit (iPhone 13).
 */

const POSTED = new Date().toISOString();
const hit = (i: number) => ({
    id: `tap-band-${i}`, title: `Platform Engineer ${i}`, company: `Acme ${i}`, company_domain: null, location: "Toronto, ON, Canada",
    location_city: "Toronto", location_state: "ON", location_country: "Canada", work_type: "remote", employment_type: "full_time",
    experience_level: "senior", salary_min: null, salary_max: null, salary_currency: null, salary_period: null, visa_sponsorship: null,
    tags: [], apply_url: "https://jobs.example.com/apply", source: "greenhouse", posted_at: POSTED, first_seen_at: POSTED,
    posted_ts: Date.parse(POSTED), updated_at: POSTED, vacancy_status: "open", ghost_badge: "clear",
});
const HITS = [1, 2, 3].map(hit);

const CONTROLS = 'button, a[href], [role="button"], [role="combobox"], input:not([type="hidden"])';

/**
 * Controls under `roots` that are on screen and miss a probe: "label @ dy".
 * Modes, from strictest: "any" (something else takes the tap), "dead" (the tap
 * lands on no control or label: a dead zone), "clip" (a clipping ancestor cut
 * the band: the probe point lies past a scroller's edge where the scroller has
 * no more content to scroll to). A control whose centre is scrolled out of view
 * is not tappable and is skipped in every mode.
 */
type ProbeMode = "any" | "dead" | "clip";
const missedProbes = (page: Page, rootSelectors: string[], mode: ProbeMode = "any") =>
    page.evaluate(
        ({ rootSelectors, controls, mode }) => {
            const misses: string[] = [];
            const seen = new Set<Element>();
            const clippers = (el: Element) => {
                const out: Element[] = [];
                for (let a = el.parentElement; a; a = a.parentElement) {
                    const s = getComputedStyle(a);
                    if (s.overflowX !== "visible" || s.overflowY !== "visible") out.push(a);
                }
                return out;
            };
            const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            const cutsOff = (a: Element, x: number, y: number) => {
                const r = a.getBoundingClientRect();
                const more = { up: a.scrollTop > 0, down: a.scrollTop + a.clientHeight < a.scrollHeight - 1, left: a.scrollLeft > 0, right: a.scrollLeft + a.clientWidth < a.scrollWidth - 1 };
                return (y < r.top && !more.up) || (y > r.bottom && !more.down) || (x < r.left && !more.left) || (x > r.right && !more.right);
            };
            for (const root of rootSelectors.flatMap((s) => [...document.querySelectorAll(s)])) {
                for (const el of root.querySelectorAll(controls)) {
                    if (seen.has(el)) continue;
                    seen.add(el);
                    const r = el.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden") continue;
                    const x = r.left + r.width / 2;
                    const cy = r.top + r.height / 2;
                    const boxes = clippers(el);
                    if (!inside(new DOMRect(0, 0, innerWidth, innerHeight), x, cy) || boxes.some((b) => !inside(b.getBoundingClientRect(), x, cy))) continue;
                    for (const dy of [0, -21, 21]) {
                        const y = cy + dy;
                        if (y < 0 || y > innerHeight) continue;
                        const top = document.elementFromPoint(x, y);
                        // A tap on a checkbox's or radio's own label is a tap on the control; the Next dev indicator is not the page.
                        const ownLabel = top?.closest("label");
                        const labelled = !!ownLabel && el instanceof HTMLInputElement && [...(el.labels ?? [])].includes(ownLabel);
                        if (top?.tagName === "NEXTJS-PORTAL") continue;
                        if (!top || !(top === el || el.contains(top) || labelled)) {
                            if (mode === "dead" && top?.closest(`${controls}, label`)) continue;
                            if (mode === "clip" && !boxes.some((b) => cutsOff(b, x, y))) continue;
                            const label = (el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
                            misses.push(`${label} @ ${dy} (hit ${top?.tagName.toLowerCase()}[${top?.getAttribute("data-testid") ?? ""}])`);
                        }
                    }
                }
            }
            return misses;
        },
        { rootSelectors, controls: CONTROLS, mode },
    );

/** The element's box has not moved for 2 animation frames (a sheet's open animation is over). */
const settled = (page: Page, selector: string) =>
    page.evaluate(
        (selector) =>
            new Promise<void>((resolve) => {
                const key = () => {
                    const r = document.querySelector(selector)?.getBoundingClientRect();
                    return r ? [r.top, r.left, r.width, r.height].join() : "";
                };
                let last = key();
                let still = 0;
                const frame = () => {
                    const now = key();
                    still = now && now === last ? still + 1 : 0;
                    last = now;
                    if (still >= 2) resolve();
                    else requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            }),
        selector,
    );

/**
 * `scroll-hit` is a pair: block padding that makes room for the tap band, and an
 * equal negative block margin that cancels it so layout does not move. A margin
 * utility on the same element (at a call site, or merged into a primitive's
 * className) replaces the negative one and silently grows the page. On a coarse
 * pointer every `.scroll-hit` element must have margin-block = -padding-block,
 * wherever its classes came from. Returns the breaks and how many it checked.
 */
const scrollHitAudit = (page: Page) =>
    page.evaluate(() => {
        const breaks: string[] = [];
        const els = [...document.querySelectorAll(".scroll-hit")];
        for (const el of els) {
            const cs = getComputedStyle(el);
            const [pt, pb, mt, mb] = [cs.paddingTop, cs.paddingBottom, cs.marginTop, cs.marginBottom].map(parseFloat);
            if (pt <= 0 || pb <= 0 || mt !== -pt || mb !== -pb) {
                const name = el.getAttribute("data-testid") || el.getAttribute("data-slot") || el.tagName.toLowerCase();
                breaks.push(`${name}: padding ${pt}/${pb}, margin ${mt}/${mb}`);
            }
        }
        return { breaks, checked: els.length };
    });

const engines = [
    { name: "chromium", launch: chromium, device: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "webkit", launch: webkit, device: devices["iPhone 13"] },
];

for (const engine of engines) {
    test(`on a phone every control in the /jobs header, toolbar and Filters sheet has a 44px tap band (${engine.name})`, { tag: ["@J-MOB-29"] }, async ({}, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone, in the engine this test launches itself");
        const baseURL = (testInfo.project.use.baseURL ?? "http://localhost:3000").toString();
        const browser = await engine.launch.launch();
        try {
            const context = await browser.newContext({ ...engine.device, baseURL });
            await context.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
            await context.route("**/api/jobs/search", (route) =>
                route.fulfill({ json: { hits: HITS, total: HITS.length, backend: "meilisearch", configured: true, searchId: "tap-band", query: "engineer" } }),
            );
            const page = await context.newPage();
            await page.goto("/jobs?q=engineer");
            await expect(page.getByTestId("jobs-toolbar")).toBeVisible({ timeout: 30_000 });
            await expect(page.getByTestId("filters-toggle")).toBeVisible();
            const region = ["header", '[data-testid="jobs-search-dock"]', '[data-testid="jobs-toolbar"]'];
            const toolbarMisses = await missedProbes(page, region);
            expect(toolbarMisses, "toolbar controls whose tap band is clipped").toEqual([]);

            const audit = await scrollHitAudit(page);
            expect(audit.checked, "/jobs has scroll-hit elements to audit").toBeGreaterThan(0);
            expect(audit.breaks, "/jobs scroll-hit elements that lost their negative margin").toEqual([]);

            await page.getByTestId("filters-toggle").tap();
            await expect(page.getByTestId("filters-panel")).toBeVisible();
            await settled(page, '[role="dialog"]');
            // The sheet's radios and checkboxes are 32px label rows, shorter than 44px by design
            // (a tap 21px off-centre lands on the next row): only a clipped band is a defect here.
            expect(await missedProbes(page, ['[role="dialog"]'], "clip"), "Filters sheet controls whose tap band is clipped").toEqual([]);
        } finally {
            await browser.close();
        }
    });
}

/** Routes whose scrolling rows use `scroll-hit`, and the probe each must pass. /login: no dead zone near any control. */
const ROUTES: Array<[string, ProbeMode]> = [["/login", "dead"], ["/connect", "clip"], ["/yours", "clip"]];

test("on a phone every scroll-hit element keeps its compensating margin and its tap band on every route (chromium)", { tag: ["@J-MOB-29"] }, async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone, in the engine this test launches itself");
    const baseURL = (testInfo.project.use.baseURL ?? "http://localhost:3000").toString();
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, baseURL });
        await context.addInitScript((key) => {
            localStorage.setItem(key, "1");
            const now = new Date().toISOString();
            const stages = ["interested", "applied", "interviewing", "offer"];
            localStorage.setItem("intervu.pursuits.guest", JSON.stringify(stages.map((status, i) => ({
                id: `g${i}`, user_id: "guest", company_name: `acme${i}`, position: `Engineer ${i}`, status, job_id: `j${i}`,
                job_snapshot: { title: `Engineer ${i}`, company: `acme${i}`, location: "Remote", description: "d", apply_url: `https://e.com/${i}` },
                job_url: `https://e.com/${i}`, created_at: now, updated_at: now,
            }))));
        }, ONBOARDING_COMPLETED_STORAGE_KEY);
        const page = await context.newPage();
        for (const [path, mode] of ROUTES) {
            await page.goto(path);
            await page.waitForLoadState("networkidle");
            const audit = await scrollHitAudit(page);
            expect(audit.checked, `${path} has scroll-hit elements to audit`).toBeGreaterThan(0);
            expect(audit.breaks, `${path} scroll-hit elements that lost their negative margin`).toEqual([]);
            expect(await missedProbes(page, ["body"], mode), `${path} controls whose tap band is missed`).toEqual([]);
        }
    } finally {
        await browser.close();
    }
});
