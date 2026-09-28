import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/** Journeys for the /jobs area — see tests/journeys/CATALOG.md (J-JOBS-*). Read-only. */

const returningVisitor = (page: import("@playwright/test").Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

async function searchFor(page: import("@playwright/test").Page, keyword: string) {
  await returningVisitor(page);
  await page.goto("/jobs");
  await page.getByPlaceholder("Job title, skill, or company").fill(keyword);
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
}

test("first-time visitor opens /jobs and sees the landing with a primary CTA", { tag: ["@J-JOBS-01"] }, async ({ page, diagnostics }) => {
  const res = await page.goto("/jobs");
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("concept-a-cta")).toBeVisible();
  await expect(page.locator("h1:visible")).toHaveCount(1);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("returning visitor searches a keyword and gets job rows", { tag: ["@J-JOBS-02"] }, async ({ page, diagnostics }) => {
  await searchFor(page, "engineer");
  await expect(page).toHaveURL(/[?&]q=engineer/);
  await expect(page.getByTestId("job-title").first()).not.toBeEmpty();
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a job page opened directly renders one h1 and an Apply button", { tag: ["@J-JOBS-03"] }, async ({ page, diagnostics }) => {
  // Slug is sourced from live search results — pinned slugs rot when listings expire.
  await searchFor(page, "engineer");
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  const res = await page.goto(path!);
  expect(res?.status()).toBe(200);
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /apply/i }).and(page.locator(":visible"))).toHaveCount(1);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("returning visitor's search session throws no uncaught page errors", { tag: ["@J-JOBS-04"] }, async ({ page, diagnostics }) => {
  test.fail(true, "known bug: prod throws minified React error #418 (hydration mismatch) for a returning visitor after search — observed 2026-09-28");
  await searchFor(page, "engineer");
  expect(diagnostics.pageErrors).toEqual([]);
});
