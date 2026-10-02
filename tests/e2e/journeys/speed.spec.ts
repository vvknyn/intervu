import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/**
 * Journeys for list speed — see tests/journeys/CATALOG.md (J-SPEED-01 to 04).
 * Vivek's budget (2026-09-30): every search and list renders in under 2 s.
 * Read-only.
 */

const SEARCH_BUDGET_MS = 2_000;

/** A phone browser's identity: signed-out phones get the list rendered on the server (server-first-rows.ts). */
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

/** The list's first-page request: the query, the first offset and facets (the count and chip probes ask for other things). */
function isFirstPageSearch(body: string, q: string): boolean {
  return body.includes(`"q":"${q}"`) && body.includes('"offset":0') && body.includes('"withFacets":true');
}

test("a typed search shows its first matching rows within 2 seconds of pressing Search", { tag: ["@J-SPEED-01"] }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await expect(input).toBeVisible({ timeout: 15_000 });
  // Let the page's own first load settle so the timer measures only the search.
  await page.waitForLoadState("networkidle");
  await input.fill("accountant");

  const startedAt = Date.now();
  await runSearch(page, input);
  // Rows from a list already on screen don't count: wait for a row from THIS search.
  await expect(page.getByTestId("job-row").first()).toContainText(/account/i, { timeout: 15_000 });
  const elapsed = Date.now() - startedAt;

  test.info().annotations.push({ type: "search-ms", description: String(elapsed) });
  expect(elapsed, `rows took ${elapsed} ms`).toBeLessThan(SEARCH_BUDGET_MS);
});

test("a search link sends its search once, early, and shows matching rows", { tag: ["@J-SPEED-03"] }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  const firstPageSearches: string[] = [];
  page.on("request", (request) => {
    const body = request.method() === "POST" ? request.postData() ?? "" : "";
    if (isFirstPageSearch(body, "nurse")) firstPageSearches.push(body);
  });

  await page.goto("/jobs?q=nurse");
  await expect(page.getByTestId("job-row").first()).toContainText(/nurs/i, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // The route gate sends it before the list code mounts and the list takes
  // that result (early-first-search.ts); two would mean the list searched again.
  expect(firstPageSearches, "first-page search requests").toHaveLength(1);
});

test.describe("a phone opening a search link", () => {
  test.use({ userAgent: PHONE_UA });

  test("gets its first rows in the page itself, within 2 seconds", { tag: ["@J-SPEED-02"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "only phones get the list rendered on the server");
    await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
    // None of the page's own code runs: rows on screen came in the HTML.
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, (route) => route.abort());

    const response = await page.goto("/jobs?q=nurse");
    expect(response, "document response").not.toBeNull();
    expect(await response!.text()).toContain('data-testid="job-row"');
    await expect(page.getByTestId("job-row").first()).toContainText(/nurs/i);

    const { responseEnd } = response!.request().timing();
    test.info().annotations.push({ type: "document-ms", description: String(Math.round(responseEnd)) });
    expect(responseEnd, `the page with its rows took ${Math.round(responseEnd)} ms`).toBeLessThan(SEARCH_BUDGET_MS);
  });

  test("the list it hydrates doesn't search again, and searching and opening a role work as usual", { tag: ["@J-SPEED-04"] }, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "only phones get the list rendered on the server");
    await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
    const searches: string[] = [];
    page.on("request", (request) => {
      const body = request.method() === "POST" ? request.postData() ?? "" : "";
      if (body.includes('"offset":0') && body.includes('"withFacets":true')) searches.push(body);
    });

    await page.goto("/jobs?q=nurse");
    const rows = page.getByTestId("job-row");
    await expect(rows.first()).toContainText(/nurs/i);
    await page.waitForLoadState("networkidle");
    // The list took the server's search (early-first-search.ts); one here would mean it searched again.
    expect(searches.filter((b) => isFirstPageSearch(b, "nurse")), "first-page searches for nurse").toHaveLength(0);

    const input = page.getByPlaceholder("Job title, skill, or company").first();
    await input.fill("accountant");
    await input.press("Enter");
    await expect(rows.first()).toContainText(/account/i, { timeout: 15_000 });
    // The address keeps /jobs: the server-rendered copy is never shown in it.
    await expect(page).toHaveURL(/\/jobs\?(.+&)?q=accountant(&|$)/);
    expect(searches.filter((b) => isFirstPageSearch(b, "accountant")), "first-page searches for accountant").toHaveLength(1);

    await rows.first().click();
    await expect(page).toHaveURL(/\/jobs\?.*job=/);
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
