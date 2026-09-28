import type { Page } from "@playwright/test";
import { JOBS_VISITOR_COOKIE } from "../../../src/lib/jobs-visitor-cookie";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS-01/23/24/25, J-SRCH-03, J-SRCH-21, J-DETAIL-01). Read-only. */

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

async function searchFor(page: Page, keyword: string) {
  await returningVisitor(page);
  await page.goto("/jobs");
  await page.getByPlaceholder("Job title, skill, or company").fill(keyword);
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

const FIRST_PAINT_MS = 5_000;
const SEARCH_INPUT = 'input[placeholder="Job title, skill, or company"]';
const POSTER = '#concept-a-ssr, [data-testid="concept-a-landing"]';

async function expectBoard(page: Page, timeout = FIRST_PAINT_MS) {
  await expect(page.locator(SEARCH_INPUT).first()).toBeVisible({ timeout });
  await expect
    .poll(() => page.getByTestId("job-row").count(), { timeout, message: "job rows on first paint" })
    .toBeGreaterThanOrEqual(5);
}

/** Fresh = empty storage. Previous-session = the visit cookie is set but velai.onboarding.completed is not. */
const VISITORS = [
  { name: "fresh visitor", previousSession: false },
  { name: "previous-session visitor (onboarding flag unset)", previousSession: true },
];

async function openJobs(page: Page, baseURL: string | undefined, previousSession: boolean) {
  if (previousSession) await page.context().addCookies([{ name: JOBS_VISITOR_COOKIE, value: "1", url: baseURL! }]);
  await page.goto("/jobs");
}

test("first-time visitor opens /jobs and sees the search box and job rows on first paint", { tag: ["@J-JOBS-01"] }, async ({ page, diagnostics }) => {
  const res = await page.goto("/jobs");
  expect(res?.status()).toBe(200);
  await expectBoard(page);
  await expect(page.locator(POSTER)).toHaveCount(0);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

for (const visitor of VISITORS) {
  test(`${visitor.name} clicks a row title and the job detail opens`, { tag: ["@J-JOBS-23"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession);
    await expectBoard(page);
    // The row centre is the company link; the title is the detail affordance.
    await page.getByTestId("job-row").getByTestId("job-title").first().click();
    await expect(page).toHaveURL(/[?&]job=/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="detail-pane"]:visible, [data-testid="mobile-detail-scroller"]:visible').first()).toBeVisible();
  });

  test(`${visitor.name} clicks Sign in or Get started and the board is still there 2s later`, { tag: ["@J-JOBS-24"] }, async ({ page, baseURL }) => {
    await openJobs(page, baseURL, visitor.previousSession);
    await expectBoard(page);
    // By accessible name, so any visible entry point counts, not one testid.
    const cta = page
      .getByRole("button", { name: /^(sign in|get started)$/i })
      .or(page.getByRole("link", { name: /^(sign in|get started)$/i }));
    await expect(cta.first()).toBeVisible();
    await cta.first().click();
    await page.waitForTimeout(2_000);
    await expectBoard(page, 1_000);
    await expect(page.locator(POSTER)).toHaveCount(0);
  });
}

test("list analytics fire: results_impressed on first render, search_submitted on a search", { tag: ["@J-JOBS-25"] }, async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_POSTHOG_KEY, "build has no NEXT_PUBLIC_POSTHOG_KEY, so captureEvent is a no-op");
  // The fixture aborts /api/telemetry; a page-level route wins, so answer it locally and read the event names.
  // Nothing leaves the browser: captureEvent's ledger POST is the carrier and it is fulfilled here.
  const events: string[] = [];
  await page.route("**/api/telemetry", async (route) => {
    const body = route.request().postDataJSON() as { events?: { event_name: string }[] };
    for (const e of body.events ?? []) events.push(e.event_name);
    await route.fulfill({ status: 204 });
  });
  await page.goto("/jobs");
  await expectBoard(page);
  await expect.poll(() => events, { timeout: 15_000, message: "results_impressed after first render" }).toContain("results_impressed");

  await page.locator(SEARCH_INPUT).first().fill("engineer");
  await page.locator(SEARCH_INPUT).first().press("Enter");
  await expect.poll(() => events, { timeout: 15_000, message: "search_submitted after a search" }).toContain("search_submitted");
});

test("returning visitor searches a keyword and gets job rows", { tag: ["@J-SRCH-03"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "engineer");
  await expect(page).toHaveURL(/[?&]q=engineer/);
  await expect(page.getByTestId("job-title").first()).not.toBeEmpty();
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a job page opened directly renders one h1 and an Apply button", { tag: ["@J-DETAIL-01"] }, async ({ page, diagnostics }) => {
  // Slug is sourced from live search results — pinned slugs rot when listings expire.
  await searchFor(page, "engineer");
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  const res = await page.goto(path!);
  expect(res?.status()).toBe(200);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /apply/i }).and(page.locator(":visible"))).toHaveCount(1);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("returning visitor's search session throws no uncaught page errors", { tag: ["@J-SRCH-21"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "engineer");
  expect(diagnostics.pageErrors).toEqual([]);
});
