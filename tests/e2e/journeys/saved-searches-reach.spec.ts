import type { Page } from "@playwright/test";
import { SAVED_SEARCHES_KEY } from "../../../src/lib/jobs/saved-searches";
import { expect, test } from "./fixtures";

/**
 * J-ALERTS-50. Saved searches are reachable in every results state, not only when there is a list:
 * #1122 moved the control into the list's action row and a search with nothing to show lost it.
 */

const saved = ["engineer", "designer"].map((q) => ({ id: q, name: q, href: `?q=${q}`, createdAt: "2026-10-01T00:00:00.000Z" }));

const EMPTY = { status: 200, body: { hits: [], total: 0, backend: "meilisearch", configured: true, searchId: "e2e-reach" } };
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
