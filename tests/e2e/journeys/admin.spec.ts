import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/** Journeys for /admin — see tests/journeys/CATALOG.md (J-ADMIN-*). Read-only. The signed-in admin journeys need an admin session and stay uncovered in the catalog. */

test("signed-out visitor opening /admin is sent to /login?next=/admin", { tag: ["@J-ADMIN-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login\?/);
  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/login");
  expect(landed.searchParams.get("next")).toBe("/admin");
  expect(diagnostics.serverErrors).toEqual([]);
});

test("a signed-out visitor on a job page sees no admin controls", { tag: ["@J-ADMIN-06"] }, async ({ page, diagnostics }) => {
  // Admin controls render only for an admin; the control asks the server only after a sign-in exists.
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill("engineer");
  await runSearch(page, input);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  const path = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href");
  await page.goto(path!);
  // Wait for the page's own report control (or the job body) so an absent admin control is not just "not rendered yet".
  await expect(page.getByTestId("job-detail-posting").or(page.getByRole("heading", { level: 1 })).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("admin-remove-listing-trigger")).toHaveCount(0);
  await expect(page.getByTestId("admin-remove-listing-dialog")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});
