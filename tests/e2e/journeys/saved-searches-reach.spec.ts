import type { Page } from "@playwright/test";
import { SAVED_SEARCHES_KEY } from "../../../src/lib/jobs/saved-searches";
import { expect, test } from "./fixtures";

/**
 * J-ALERTS-50. Saved searches are reachable in every results state, not only when there is a list:
 * #1122 moved the control into the list's action row and a search with nothing to show lost it.
 */

const saved = ["engineer", "designer"].map((q) => ({ id: q, name: q, href: `?q=${q}`, createdAt: "2026-10-01T00:00:00.000Z" }));

const EMPTY = { status: 200, body: { hits: [], total: 0, backend: "meilisearch", configured: true, searchId: "e2e-reach" } };
// A constructed posting (no real company), the shape the list's search answers with.
const POSTING = {
    id: "44444444-0000-4000-8000-000000000001", title: "Software Engineer", company: "Birch Cloud", company_domain: null, location: "Remote, Canada",
    location_city: null, location_state: null, location_country: "Canada", work_type: "remote", description: null, employment_type: "full_time",
    experience_level: "senior", salary_min: null, salary_max: null, salary_currency: null, salary_period: null, visa_sponsorship: null, tags: [],
    apply_url: "https://example.com/apply", source: "journey", posted_at: new Date(Date.now() - 86_400_000).toISOString(), first_seen_at: null,
    updated_at: null, vacancy_status: "open", ghost_badge: "unscored",
};
const LISTED = { status: 200, body: { hits: [POSTING], total: 1, backend: "meilisearch", configured: true, searchId: "e2e-reach" } };
const FAILED = { status: 500, body: { error: "down" } };

/** Where the list lives: one row above the panel, docked header (desktop) or not. */
const home = (page: Page) => page.getByTestId("jobs-saved-searches-row");

async function open(page: Page, answer: { status: number; body: unknown }) {
    await page.addInitScript(([key, list]) => localStorage.setItem(key, list), [SAVED_SEARCHES_KEY, JSON.stringify(saved)] as const);
    await page.route("**/api/jobs/search", (route) => route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) }));
    await page.goto("/jobs?q=engineer");
}

test("zero results: both saved searches are listed, with no second Job alert", { tag: ["@J-ALERTS-50"] }, async ({ page, isMobile }) => {
    await open(page, EMPTY);
    if (!isMobile) await expect(page.getByTestId("topbar-docked-search")).toBeVisible({ timeout: 30_000 }); // desktop: the header is docked
    await expect(home(page).getByTestId("saved-search-item")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId("saved-search-item")).toHaveCount(2); // one list, not one per placement
    // The empty state keeps its single Job alert; the saved searches add none.
    await expect(home(page).getByText(/job alert/i)).toHaveCount(0);
});

test("a failed search: both saved searches are still listed", { tag: ["@J-ALERTS-50"] }, async ({ page }) => {
    await open(page, FAILED);
    await expect(page.getByTestId("jobs-search-error")).toBeVisible({ timeout: 30_000 });
    await expect(home(page).getByTestId("saved-search-item")).toHaveCount(2);
    await expect(page.getByTestId("saved-search-item")).toHaveCount(2);
});

/**
 * A refinement goes list -> loading -> list. The control lives in the list's action row, so it must leave with
 * the list and come back with it: each mount asks the server for one "N new" count per saved search, and a
 * mount in the transient loading step doubled those (2N per refinement against N on the base).
 */
test("a refinement asks for each saved search's count once, not once per panel it passes through", { tag: ["@J-ALERTS-50"] }, async ({ page }) => {
    await page.addInitScript(([key, list]) => localStorage.setItem(key, list), [SAVED_SEARCHES_KEY, JSON.stringify(saved)] as const);
    const counts: number[] = []; // when each saved search's count was asked for
    page.on("request", (request) => {
        const body = request.method() === "POST" && request.headers()["next-action"] ? (request.postData() ?? "") : "";
        if (body.includes('"scope":"saved"')) counts.push(Date.now());
    });
    // A slow answer, so the page really sits in its loading panel between the two lists.
    await page.route("**/api/jobs/search", async (route) => {
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LISTED.body) });
    });
    await page.goto("/jobs?q=engineer");
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("saved-search-item")).toHaveCount(2, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    expect(counts.length, "the first mount asked for both saved searches").toBeGreaterThanOrEqual(saved.length);

    counts.length = 0;
    const input = page.locator('input[placeholder="Job title, skill, or company"]').first();
    await input.fill("data analyst");
    await input.press("Enter");
    await expect(page).toHaveURL(/[?&]q=data(\+|%20)analyst/, { timeout: 30_000 });
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("saved-search-item")).toHaveCount(2);
    await page.waitForLoadState("networkidle");
    // One mount asks for every saved search together (React dev StrictMode runs that effect twice, so up to
    // twice each); a second mount is a second burst, 400 ms later at the earliest (the answer's delay above).
    const bursts = counts.filter((t, i) => i === 0 || t - counts[i - 1] > 200).length;
    expect(bursts, "times the saved searches were counted again by one refinement").toBe(1);
    expect(counts.length, "count requests sent by the refinement: one burst, at most twice per saved search").toBeLessThanOrEqual(saved.length * 2);
});

test("a guest with no saved searches gets no empty row above the panel", { tag: ["@J-ALERTS-50"] }, async ({ page }) => {
    await page.route("**/api/jobs/search", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY.body) }));
    await page.goto("/jobs?q=zzzznoresults");
    await expect(page.getByTestId("search-empty-results")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("saved-search-item")).toHaveCount(0);
    // The row is the wrapper around a control that renders nothing: it must take no space, its margin included.
    const space = await home(page).evaluateAll((els) =>
        els.map((el) => {
            if (el.getClientRects().length === 0) return 0; // display: none takes no space, whatever its margin says
            const cs = getComputedStyle(el);
            return el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
        }),
    );
    expect(space.every((px) => px === 0), `space the empty row takes, px: ${space}`).toBe(true);
});
