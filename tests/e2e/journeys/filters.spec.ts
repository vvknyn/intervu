import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { filtersToggle, openGroup, showFilters } from "./filters-panel";

/**
 * Journeys for the /jobs filters — see tests/journeys/CATALOG.md (J-FILT-*). Read-only.
 *
 * The salary floor used to reach the URL only for 50k/100k/150k/200k, so
 * $30k+, $75k+ and any custom minimum were lost on reload or when the link
 * was shared.
 */

async function openFilters(page: Page) {
  await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
  await page.goto("/jobs?q=software+engineer");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  return showFilters(page);
}

const salaryParam = (page: Page) => new URL(page.url()).searchParams.get("salary");

test("Pick $75k+ salary: the URL says salary=75k and a reload keeps it", { tag: ["@J-FILT-08"] }, async ({ page, diagnostics }) => {
  const panel = await openFilters(page);
  await (await openGroup(panel, "salary")).getByRole("radio", { name: "$75k+" }).click();
  await expect.poll(() => salaryParam(page)).toBe("75k");

  await page.reload();
  await expect.poll(() => salaryParam(page)).toBe("75k");
  await expect((await showFilters(page)).getByRole("radio", { name: "$75k+" })).toBeChecked();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("A custom minimum salary goes into the URL and a reload keeps it", { tag: ["@J-FILT-09"] }, async ({ page, diagnostics }) => {
  const panel = await openFilters(page);
  const custom = (await openGroup(panel, "salary")).getByTestId("salary-custom-min");
  await custom.fill("65500");
  await custom.press("Enter");
  await expect.poll(() => salaryParam(page)).toBe("65500");

  await page.reload();
  await expect.poll(() => salaryParam(page)).toBe("65500");
  await expect((await showFilters(page)).getByTestId("salary-custom-min")).toHaveValue("65500");
  expect(diagnostics.pageErrors).toEqual([]);
});

/** The applied-filter chips, in the header band on a laptop and under the controls on a phone. */
const appliedChips = (page: Page) => page.locator('[data-testid="topbar-docked-chip"], [data-testid="active-filter-chip"]');
/** The work-mode chip alone: a visitor whose IP maps to a country also sees that country's default chip (Canada), so a bare chip count depends on where the test runs. */
const workModeChips = (page: Page) => appliedChips(page).filter({ hasText: /work mode/i });

test(
  "On a laptop the filters are a rail on the left of the list: pick a work mode, see its chip, Clear all empties both, the rail collapses from its own button and stays collapsed over a reload",
  { tag: ["@J-FILT-27"] },
  async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a laptop width");
    const panel = await openFilters(page);
    const rail = page.getByTestId("filters-rail");
    await expect(rail, "open from the first results, no click").toBeVisible();
    const [railBox, rowBox] = [(await rail.boundingBox())!, (await page.getByTestId("job-row").first().boundingBox())!];
    expect(railBox.x + railBox.width, "the rail sits left of the list").toBeLessThanOrEqual(rowBox.x);
    for (const id of ["salary", "work_type", "experience_level"]) await expect(panel.getByTestId(`filter-section-${id}`)).toBeVisible();
    await expect(page.getByTestId("filters-clear-all"), "nothing applied, nothing to clear").toBeDisabled();

    // Work mode is open from the start: pick its first value.
    const work = await openGroup(panel, "work_type");
    await work.getByRole("checkbox").first().check();
    await expect.poll(() => new URL(page.url()).searchParams.get("work")).not.toBeNull();
    await expect(workModeChips(page), "the applied filter is named as a chip").toHaveCount(1);
    await expect(page.getByTestId("filters-clear-all")).toBeEnabled();

    await page.getByTestId("filters-clear-all").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("work")).toBeNull();
    await expect(workModeChips(page)).toHaveCount(0);
    await expect(page.getByTestId("filters-clear-all")).toBeDisabled();

    // The rail's own Hide button collapses it; the list takes the width and a reload keeps it hidden.
    await page.getByTestId("filters-rail-hide").click();
    await expect(rail).toHaveCount(0);
    await expect(filtersToggle(page)).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(rail).toHaveCount(0);
    await filtersToggle(page).click();
    await expect(rail).toBeVisible();
    await expect(filtersToggle(page)).toHaveAttribute("aria-expanded", "true");
    expect(diagnostics.pageErrors).toEqual([]);
  },
);

test(
  "On a phone Filters opens a bottom sheet with the same groups; a pick shows as a chip and Show jobs closes the sheet",
  { tag: ["@J-FILT-28"] },
  async ({ page, diagnostics }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a phone width");
    await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
    await page.goto("/jobs?q=software+engineer");
    await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("filters-rail"), "no rail on a phone").toHaveCount(0);

    await filtersToggle(page).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    const panel = page.getByTestId("filters-panel");
    for (const id of ["salary", "work_type", "experience_level"]) await expect(panel.getByTestId(`filter-section-${id}`)).toBeVisible();

    const work = await openGroup(panel, "work_type");
    await work.getByRole("checkbox").first().check();
    await expect.poll(() => new URL(page.url()).searchParams.get("work")).not.toBeNull();
    await expect(sheet.getByRole("button", { name: "Clear all" })).toBeEnabled();

    await sheet.getByRole("button", { name: /^Show (results|[\d,]+\+? jobs?)$/ }).click();
    await expect(sheet).toBeHidden();
    await expect(appliedChips(page), "the pick is still on screen as a chip").toHaveCount(1);
    await expect(appliedChips(page).first()).toBeInViewport();
    expect(diagnostics.pageErrors).toEqual([]);
  },
);

test(
  "A search the filters leave empty keeps the filters on screen, with the applied ones ticked, so one can be loosened",
  { tag: ["@J-FILT-29"] },
  async ({ page, diagnostics }, testInfo) => {
    await page.addInitScript(([key]) => localStorage.setItem(key, "1"), [ONBOARDING_COMPLETED_STORAGE_KEY]);
    await page.route("**/api/jobs/search", (route) =>
      route.fulfill({ json: { hits: [], total: 0, backend: "meilisearch", configured: true, searchId: "j-filt-29", query: "software engineer", facetDistribution: {} } }),
    );
    await page.goto("/jobs?q=software+engineer&work=remote&salary=200k");
    const panel = await showFilters(page);
    if (testInfo.project.name === "desktop") await expect(page.getByTestId("filters-rail")).toBeVisible();
    const work = await openGroup(panel, "work_type");
    await expect(work.getByRole("checkbox", { name: /^Remote/ })).toBeChecked();
    await expect((await openGroup(panel, "salary")).getByRole("radio", { name: "$200k+" })).toBeChecked();

    await work.getByRole("checkbox", { name: /^Remote/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("work")).toBeNull();
    expect(diagnostics.pageErrors).toEqual([]);
  },
);
