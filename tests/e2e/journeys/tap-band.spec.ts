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

/** Controls under `roots` that are on screen and miss a probe: "label @ dy". */
const missedProbes = (page: Page, rootSelectors: string[]) =>
    page.evaluate(
        ({ rootSelectors, controls }) => {
            const misses: string[] = [];
            const seen = new Set<Element>();
            for (const root of rootSelectors.flatMap((s) => [...document.querySelectorAll(s)])) {
                for (const el of root.querySelectorAll(controls)) {
                    if (seen.has(el)) continue;
                    seen.add(el);
                    const r = el.getBoundingClientRect();
                    if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden") continue;
                    const x = r.left + r.width / 2;
                    const cy = r.top + r.height / 2;
                    // Scrolled out of its row (or the screen) is not tappable; the row's own scroll brings it in.
                    const clip = el.closest('[data-testid="jobs-toolbar-rows"]')?.getBoundingClientRect();
                    if (x < (clip?.left ?? 0) || x > (clip?.right ?? innerWidth)) continue;
                    for (const dy of [0, -21, 21]) {
                        const y = cy + dy;
                        if (y < 0 || y > innerHeight) continue;
                        const top = document.elementFromPoint(x, y);
                        // A tap on a checkbox's or radio's own label is a tap on the control; the Next dev indicator is not the page.
                        const ownLabel = top?.closest("label");
                        const labelled = !!ownLabel && el instanceof HTMLInputElement && [...(el.labels ?? [])].includes(ownLabel);
                        if (top?.tagName === "NEXTJS-PORTAL") continue;
                        if (!top || !(top === el || el.contains(top) || labelled)) {
                            const label = (el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
                            misses.push(`${label} @ ${dy} (hit ${top?.tagName.toLowerCase()}[${top?.getAttribute("data-testid") ?? ""}])`);
                        }
                    }
                }
            }
            return misses;
        },
        { rootSelectors, controls: CONTROLS },
    );

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

            await page.getByTestId("filters-toggle").tap();
            await expect(page.getByTestId("filters-panel")).toBeVisible();
            expect(await missedProbes(page, ['[role="dialog"]']), "Filters sheet controls whose tap band is clipped").toEqual([]);
        } finally {
            await browser.close();
        }
    });
}
