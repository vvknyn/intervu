import type { Page } from "@playwright/test";
import { JOBS_USP } from "../../../src/lib/jobs/jobs-usp-copy";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/**
 * Journeys for list speed — see tests/journeys/CATALOG.md (J-SPEED-01 to 08).
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

/** The front door's résumé invite (FrontDoorResumeBand). */
const RESUME_BAND = 'section[aria-label="Add your resume"]';
const HEADLINE = JOBS_USP.mastheadTitle;

test.describe("a signed-out visitor opening velai.app", () => {
  test("sees the front door from the page's own HTML, before any of its code runs", { tag: ["@J-SPEED-05"] }, async ({ page }) => {
    // None of the page's code runs: what shows came in the HTML.
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, (route) => route.abort());

    const response = await page.goto("/");
    expect(response, "document response").not.toBeNull();
    expect(new URL(response!.url()).pathname, "velai.app still opens /jobs").toBe("/jobs");
    const html = await response!.text();
    expect(html).toContain(HEADLINE);
    expect(html).toContain('aria-label="Add your resume"');

    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await expect(page.getByPlaceholder("Job title, skill, or company").first()).toBeVisible();
    await expect(page.locator(RESUME_BAND).getByRole("button", { name: "Upload résumé" })).toBeVisible();
  });

  test("gets a front door that hydrates cleanly and searches and uploads as before", { tag: ["@J-SPEED-06"] }, async ({ page, diagnostics }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    // Interact once the page's code has run (a click before hydration does nothing).
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/jobs$/);
    // A server render the browser disagreed with would show as React's hydration errors.
    expect(diagnostics.consoleErrors.filter((e) => /hydrat|#418|#423|#425/i.test(e)), "hydration errors").toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);

    await page.locator(RESUME_BAND).getByRole("button", { name: "Upload résumé" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("resume-import-parse-primary")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const input = page.getByPlaceholder("Job title, skill, or company").first();
    await input.fill("accountant");
    await runSearch(page, input);
    await expect(page.getByTestId("job-row").first()).toContainText(/account/i, { timeout: 15_000 });
    // The server-drawn copy is never shown in the address bar.
    await expect(page).toHaveURL(/\/jobs\?(.+&)?q=accountant(&|$)/);
    expect(diagnostics.serverErrors).toEqual([]);
  });

  /**
   * Holds the page's scripts until the returned release is called, so a spec
   * can act on the server-drawn page before any of its code runs.
   */
  async function holdScripts(page: Page) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/_next\/static\/chunks\/.+\.js(\?.*)?$/, async (route) => {
      await held;
      await route.continue().catch(() => {});
    });
    return release;
  }

  test("can search before the page's code has run: Enter sends the typed search to /jobs?q=", { tag: ["@J-SPEED-07"] }, async ({ page, diagnostics }) => {
    const release = await holdScripts(page);
    await page.goto("/", { waitUntil: "commit" });
    const input = page.getByPlaceholder("Job title, skill, or company").first();
    await expect(input).toBeVisible();
    await input.fill("nurse");
    // A plain form submit: the page's code hasn't run, so nothing else could send it.
    await input.press("Enter");
    await page.waitForURL(/\/jobs\?(.+&)?q=nurse(&|$)/, { waitUntil: "commit" });
    release();
    await expect(page.getByTestId("job-row").first()).toContainText(/nurs/i, { timeout: 15_000 });
    await expect(page.getByPlaceholder("Job title, skill, or company").first()).toHaveValue("nurse");
    // The empty place field the form sent along is not left in the address.
    await expect(page).toHaveURL(/\/jobs\?q=nurse$/);
    expect(diagnostics.serverErrors).toEqual([]);
  });

  test("keeps what was typed before the page's code ran once it runs, and Search then runs it", { tag: ["@J-SPEED-08"] }, async ({ page, diagnostics }) => {
    const release = await holdScripts(page);
    await page.goto("/", { waitUntil: "commit" });
    const input = page.getByPlaceholder("Job title, skill, or company").first();
    await expect(input).toBeVisible();
    await input.fill("nurse");
    // The place field is a text field from lg up; below that it is a button that opens a sheet.
    const place = page.getByTestId("location-input");
    const typedPlace = await place.isVisible();
    if (typedPlace) await place.fill("Toronto");

    release();
    await page.waitForLoadState("networkidle");
    await expect(input).toHaveValue("nurse");
    if (typedPlace) await expect(place).toHaveValue("Toronto");
    expect(diagnostics.consoleErrors.filter((e) => /hydrat|#418|#423|#425/i.test(e)), "hydration errors").toEqual([]);

    if (typedPlace) await place.fill("");
    await runSearch(page, input);
    await expect(page).toHaveURL(/\/jobs\?(.+&)?q=nurse(&|$)/);
    await expect(page.getByTestId("job-row").first()).toContainText(/nurs/i, { timeout: 15_000 });
    expect(diagnostics.serverErrors).toEqual([]);
  });
});
