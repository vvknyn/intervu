import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for list speed — see tests/journeys/CATALOG.md (J-SPEED-01).
 * Vivek's budget (2026-09-30): every search and list renders in under 2 s.
 * Read-only.
 */

const SEARCH_BUDGET_MS = 2_000;

test("a typed search shows its first matching rows within 2 seconds of pressing Search", { tag: ["@J-SPEED-01"] }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await expect(input).toBeVisible({ timeout: 15_000 });
  // Let the page's own first load settle so the timer measures only the search.
  await page.waitForLoadState("networkidle");
  await input.fill("accountant");

  const startedAt = Date.now();
  await page.getByTestId("search-submit").click();
  // Rows from a list already on screen don't count: wait for a row from THIS search.
  await expect(page.getByTestId("job-row").first()).toContainText(/account/i, { timeout: 15_000 });
  const elapsed = Date.now() - startedAt;

  test.info().annotations.push({ type: "search-ms", description: String(elapsed) });
  expect(elapsed, `rows took ${elapsed} ms`).toBeLessThan(SEARCH_BUDGET_MS);
});

test("a search link sends its search once, early, and shows matching rows", { tag: ["@J-SPEED-03"] }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  // The list's first-page request: the server action's arguments carry the
  // query, the first offset and facets (the count and chip probes that follow
  // the list ask for other things).
  const firstPageSearches: string[] = [];
  page.on("request", (request) => {
    const body = request.method() === "POST" ? request.postData() ?? "" : "";
    if (body.includes('"q":"nurse"') && body.includes('"offset":0') && body.includes('"withFacets":true')) {
      firstPageSearches.push(body);
    }
  });

  await page.goto("/jobs?q=nurse");
  await expect(page.getByTestId("job-row").first()).toContainText(/nurs/i, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // The route gate sends it before the list code mounts and the list takes
  // that result (early-first-search.ts); two would mean the list searched again.
  expect(firstPageSearches, "first-page search requests").toHaveLength(1);
});
