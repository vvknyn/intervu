import type { Page } from "@playwright/test";
import { LOCAL_AI_RESUME_KEY } from "../../../src/lib/local-ai/resume-storage";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { auditWrapping } from "../helpers/wrap-audit";
import { WRAP_FIXTURE_READY, auditedPaths, isFixture } from "../helpers/wrap-routes";
import { expect, test } from "./fixtures";
import { isLocalOrigin, mockSignIn, SIGNED_IN_SKIP_REASON } from "./signed-in";

/**
 * Journeys for the phone wrapping class (see tests/journeys/CATALOG.md, J-MOB-33 and J-MOB-34): a row of buttons that
 * wraps ragged, a run of plain items with its last item alone, a "·" that ends or starts a line, and a footer link
 * alone on its last line, on every page route (tests/e2e/helpers/wrap-routes.ts lists each one, audited or skipped
 * with a reason). The question is asked of the rendered page by `auditWrapping` (tests/e2e/helpers/wrap-audit.ts), at
 * 390 and 320 wide. A page that draws rows only when its data answers (/trends, a career hub, a company) is asked
 * through its /mock fixture. Read-only. Job rows and the job detail join their facts with `MetaLine`, whose trailing
 * dot is the contract J-MOB-24 and J-MOB-26 keep, so the job detail is not in the list.
 */

const returningVisitor = (page: Page) => page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

const audit = (page: Page) => page.evaluate(auditWrapping);

/** Pages a signed-out visitor reaches (every audited route that is not a fixture) and the fixtures that stand in for data-driven ones. */
const PAGES = auditedPaths().filter((p) => !isFixture(p));
const FIXTURES = auditedPaths().filter(isFixture);

for (const width of [390, 320]) {
    for (const path of PAGES) {
        test(`on a ${width}px phone ${path} has no ragged button row, no stranded link and no "·" at the edge of a line`, { tag: ["@J-MOB-33"] }, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile", "a phone width");
            await page.setViewportSize({ width, height: 800 });
            await returningVisitor(page);
            await page.goto(path);
            // A page's title, or its footer where it has none (a data-driven page that cannot reach its data has no title): the sign-in walls and auth pages have no footer.
            await expect(page.locator("h1, [data-testid='site-footer']").first()).toBeVisible({ timeout: 20_000 });
            // Polled: the page settles after first paint (the board, the header's auth slot).
            await expect.poll(() => audit(page), { timeout: 10_000 }).toEqual([]);
        });
    }

    for (const path of FIXTURES) {
        test(`on a ${width}px phone the ${path} fixture, with its data drawn, has no ragged row and no stranded item`, { tag: ["@J-MOB-33"] }, async ({ page, baseURL }, testInfo) => {
            test.skip(testInfo.project.name !== "mobile", "a phone width");
            test.skip(!isLocalOrigin(baseURL), "fixture pages exist only on a local server");
            await page.setViewportSize({ width, height: 800 });
            await returningVisitor(page);
            const res = await page.goto(path);
            test.skip(res?.status() === 404, "this server has no fixture pages");
            // The fixture exists to draw what only data draws; if that is missing the audit would be measuring an empty page.
            for (const id of WRAP_FIXTURE_READY[path] ?? []) await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 });
            await expect.poll(() => audit(page), { timeout: 10_000 }).toEqual([]);
        });
    }

    test(`on a ${width}px phone the company page's identity line is a fact line, with no dot as text`, { tag: ["@J-MOB-33"] }, async ({ page, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        test.skip(!isLocalOrigin(baseURL), "fixture pages exist only on a local server");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        const res = await page.goto("/mock/company-page");
        test.skip(res?.status() === 404, "this server has no fixture pages");
        const identity = page.getByTestId("company-section-identity").locator(".fact-line").first();
        await expect(identity).toBeVisible({ timeout: 20_000 });
        expect(await identity.evaluate((e) => (e.textContent ?? "").includes("·"))).toBe(false);
    });

    test(`on a ${width}px phone /trends keeps its legend and links in columns and its sources as facts`, { tag: ["@J-MOB-33"] }, async ({ page, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        test.skip(!isLocalOrigin(baseURL), "fixture pages exist only on a local server");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        const res = await page.goto("/mock/trends");
        test.skip(res?.status() === 404, "this server has no fixture pages");
        const coverage = page.getByTestId("trends-pulse-coverage").locator(".fact-line");
        await expect(coverage).toBeVisible({ timeout: 20_000 });
        expect(await coverage.evaluate((e) => (e.textContent ?? "").includes("·"))).toBe(false);
        // The four employment types and the three workplace types are link clouds (the audit above asks that none is left alone).
        for (const [section, count] of [["trends-experience-levels", 4], ["trends-work-types", 3]] as const) {
            const cloud = page.getByTestId(section).locator(".link-cloud");
            await expect(cloud).toBeVisible();
            await expect(cloud.locator("> *")).toHaveCount(count);
        }
    });
}

const RESUME = {
    profile: {
        name: "Vivek Narayanan",
        profession: "Technical Account Manager",
        yearsOfExperience: 11,
        location: "Richmond Hill, Ontario",
        email: "viveknyan@gmail.com",
        phone: "+1 (437) 224-8332",
        linkedin: "linkedin.com/in/viveknar",
    },
    generatedSummary: "Enterprise Technical Account Manager with 13 years across platform and SaaS.",
    competencies: [{ category: "Skills", skills: ["Go", "TypeScript"] }],
    experience: [{ id: "exp-0", role: "Senior Technical Account Manager", company: "Acme Cloud", dates: "2021 – Present", description: "Led the renewal program" }],
    education: [],
};
const UPDATED_AT = "2026-10-27T00:00:00.000Z";

/** Next server-action response in flight format: `1:` carries the action's return value. */
const flight = (value: unknown) => `0:{"a":"$@1","f":"","q":"","i":true,"b":"development"}\n1:D"$2"\n1:${JSON.stringify(value)}\n`;

/** An account (the dev-only sign-in hook) whose résumé is stored as structured data: answers the résumé read in the browser. */
async function signedInWithResume(page: Page) {
    await mockSignIn(page);
    await page.route(
        () => true,
        async (route) => {
            const req = route.request();
            if (req.method() !== "POST" || !req.headers()["next-action"]) return route.continue();
            const res = await route.fetch();
            const text = await res.text();
            const body = req.postData() === "[]" && text.includes('"Unauthorized"') ? flight({ data: { source: "resume_data", resume_data: RESUME, updatedAt: UPDATED_AT } }) : text;
            return route.fulfill({ response: res, body });
        },
    );
}

for (const width of [390, 320]) {
    test(`on a ${width}px phone the résumé's buttons fill their lines and its headline and contact lines wrap between facts`, { tag: ["@J-MOB-34"] }, async ({ page, baseURL }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        test.skip(!process.env.E2E_STORAGE_STATE && !isLocalOrigin(baseURL), SIGNED_IN_SKIP_REASON);
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        await signedInWithResume(page);
        await page.goto("/resume");
        const edit = page.getByRole("button", { name: "Edit template" });
        await expect(edit).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("guest-resume-readout")).toBeVisible();

        // The row was "Edit template / Replace", "Download .pdf / Download .json", then "Delete" alone and off-centre.
        const row = page.locator(".action-row").filter({ has: edit });
        const buttons = row.getByRole("button");
        expect(await buttons.count()).toBe(5);
        const cells = await buttons.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) })));
        const frame = await row.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return { left: Math.round(r.left), right: Math.round(r.right) };
        });
        const lines = [...new Set(cells.map((c) => c.top))];
        for (const top of lines) {
            const line = cells.filter((c) => c.top === top);
            // Every line runs from the card's left edge to its right edge, whatever it holds.
            expect(Math.min(...line.map((c) => c.left)), `a line at ${top}`).toBeLessThanOrEqual(frame.left + 1);
            expect(Math.max(...line.map((c) => c.right)), `a line at ${top}`).toBeGreaterThanOrEqual(frame.right - 1);
        }
        // Delete is the last button and, alone on its line, takes all of it.
        const del = cells[cells.length - 1];
        expect(cells.filter((c) => c.top === del.top)).toHaveLength(1);
        expect(del.right - del.left).toBeGreaterThanOrEqual(frame.right - frame.left - 2);

        // The headline and the contact line break between facts; no "·" is left at the end of a line or the start of the next.
        const lineOfFacts = page.getByTestId("guest-resume-readout").locator(".fact-line");
        expect(await lineOfFacts.count()).toBe(2);
        expect(await page.getByTestId("guest-resume-readout").evaluate((e) => (e.querySelector(".fact-line")?.textContent ?? "").includes("·"))).toBe(false);
        await expect.poll(() => audit(page), { timeout: 10_000 }).toEqual([]);
    });
}

for (const width of [390, 320]) {
    test(`on a ${width}px phone a guest's résumé on this device keeps its buttons and fact lines whole`, { tag: ["@J-MOB-34"] }, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "mobile", "a phone width");
        await page.setViewportSize({ width, height: 800 });
        await returningVisitor(page);
        await page.addInitScript(
            ([key, value]) => {
                if (!sessionStorage.getItem("seeded")) {
                    localStorage.setItem(key, value);
                    sessionStorage.setItem("seeded", "1");
                }
            },
            [LOCAL_AI_RESUME_KEY, JSON.stringify({ data: RESUME, updatedAt: UPDATED_AT, sourceLabel: "vivek.pdf" })],
        );
        await page.goto("/resume");
        await expect(page.getByTestId("guest-resume-readout")).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId("resume-local-account-pitch")).toBeVisible();
        await expect.poll(() => audit(page), { timeout: 10_000 }).toEqual([]);
    });
}
