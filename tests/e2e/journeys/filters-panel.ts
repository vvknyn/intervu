import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Reaching the /jobs filters from a journey. They are one panel (`filters-panel`)
 * in three frames: a rail beside the list on a laptop (already on screen), a
 * drawer on a laptop with no list yet, a bottom sheet on a phone (the last two
 * open from the Filters button). The groups inside are the same everywhere, and
 * the ones nobody has used stay folded until opened.
 */

/** The Filters button is in the toolbar, or in the header once the search docks there (laptop). */
const TOGGLE = '[data-testid="filters-toggle"]:visible, [data-testid="topbar-docked-filters-toggle"]:visible';

/** The filters panel, opened if it is not already on screen. */
export async function showFilters(page: Page): Promise<Locator> {
  const panel = page.getByTestId("filters-panel");
  await expect(page.locator(`[data-testid="filters-panel"]:visible, ${TOGGLE}`).first()).toBeVisible({ timeout: 30_000 });
  // On a laptop the rail mounts a beat after hydration (the server draws the narrow layout), and a
  // click before then would hide it. A rail the searcher hid is the one case that waits this out.
  if ((page.viewportSize()?.width ?? 0) >= 1024) await panel.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await panel.isVisible()) return panel;
  // The server draws the button before it has a handler, so a click that early is lost: try again until it opens.
  await expect(async () => {
    if (!(await panel.isVisible())) await page.locator(TOGGLE).first().click();
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  return panel;
}

/** The Filters button, wherever it sits at this width. */
export const filtersToggle = (page: Page) => page.locator(TOGGLE).first();

/** One group of the panel (`posted`, `salary`, `work_type`, `experience_level`, `years`, …), opened if it is folded. */
export async function openGroup(panel: Locator, id: string): Promise<Locator> {
  const group = panel.getByTestId(`filter-section-${id}`);
  await expect(group).toBeVisible();
  if (!(await group.evaluate((el) => (el as HTMLDetailsElement).open))) await group.locator("summary").click();
  await expect(group.locator("label").first()).toBeVisible();
  return group;
}
