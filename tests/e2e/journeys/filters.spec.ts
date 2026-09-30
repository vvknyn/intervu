import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for the /jobs filters — see tests/journeys/CATALOG.md (J-FILT-*). Read-only.
 *
 * The salary floor used to reach the URL only for 50k/100k/150k/200k, so
 * $30k+, $75k+ and any custom minimum were lost on reload or when the link
 * was shared.
 */

/** The Filters button is in the toolbar, or in the header once the search docks there (desktop). */
async function showFilters(page: Page) {
  const panel = page.getByTestId("filters-panel");
  const entry = page.locator(
    '[data-testid="filters-panel"]:visible, [data-testid="filters-toggle"]:visible, [data-testid="topbar-docked-filters-toggle"]:visible',
  );
  await expect(entry.first()).toBeVisible({ timeout: 30_000 });
  if (await panel.isVisible()) return panel;
  await page.locator('[data-testid="filters-toggle"]:visible, [data-testid="topbar-docked-filters-toggle"]:visible').first().click();
  await expect(panel).toBeVisible();
  return panel;
}

async function openFilters(page: Page) {
  await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
  await page.goto("/jobs?q=software+engineer");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  return showFilters(page);
}

const salaryParam = (page: Page) => new URL(page.url()).searchParams.get("salary");

test("Pick $75k+ salary: the URL says salary=75k and a reload keeps it", { tag: ["@J-FILT-08"] }, async ({ page, diagnostics }) => {
  const panel = await openFilters(page);
  await panel.getByRole("radio", { name: "$75k+" }).click();
  await expect.poll(() => salaryParam(page)).toBe("75k");

  await page.reload();
  await expect.poll(() => salaryParam(page)).toBe("75k");
  await expect((await showFilters(page)).getByRole("radio", { name: "$75k+" })).toBeChecked();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A custom minimum salary goes into the URL and a reload keeps it", { tag: ["@J-FILT-09"] }, async ({ page, diagnostics }) => {
  const panel = await openFilters(page);
  const custom = panel.getByTestId("salary-custom-min");
  await custom.fill("65500");
  await custom.press("Enter");
  await expect.poll(() => salaryParam(page)).toBe("65500");

  await page.reload();
  await expect.poll(() => salaryParam(page)).toBe("65500");
  await expect((await showFilters(page)).getByTestId("salary-custom-min")).toHaveValue("65500");
  expect(diagnostics.pageErrors).toEqual([]);
});
