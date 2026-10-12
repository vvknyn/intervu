import { expect, test } from "./fixtures";

/**
 * Journeys for the /careers hubs, the pages people land on from search —
 * see tests/journeys/CATALOG.md (J-CONTENT-01). Read-only.
 *
 * Every hub's main link went to a bare /jobs, so a nurse who came in on the
 * nursing hub had to search again to see a single nursing role (focus group,
 * 2026-10-12). Each hub now links to its own search.
 */

test("a career hub's main link opens the search for the roles the page is about", { tag: ["@J-CONTENT-01"] }, async ({ page, diagnostics }) => {
  await page.goto("/careers/nursing-jobs");
  const link = page.getByTestId("career-hub-search");
  await expect(link).toHaveText("Search nursing jobs");
  await link.click();
  await expect(page).toHaveURL(/\/jobs\?q=Nurse\b/);
  await expect(page.getByPlaceholder("Job title, skill, or company").and(page.locator(":visible")).first()).toHaveValue("Nurse", { timeout: 15_000 });

  await page.goto("/careers/remote-jobs");
  await expect(page.getByTestId("career-hub-search")).toHaveAttribute("href", "/jobs?work=remote");
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});
