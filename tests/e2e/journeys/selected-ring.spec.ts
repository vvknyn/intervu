import type { Locator, Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";
import { isLocalOrigin } from "./signed-in";
import { brokenEdges, edgeMatch } from "./ring-edges";

/**
 * Journeys for the rings a row draws inside its box — see tests/journeys/CATALOG.md (J-JOBS-161, J-JOBS-162).
 * Read-only: the search answer is replaced in the browser (no backend needed).
 *
 * The selected /jobs row's 1px ring and a keyboard-focused row's 2px ring were inset box-shadows, which paint
 * before the row's children, so the divider under the row's text column painted over the ring's bottom edge
 * (2026-10-25: the bottom was visible only from the row's left edge to the title and over the last 30px). The
 * samplers read the pixels along all four edges at 2x, so a ring something paints over reads as a break.
 */
test.use({ deviceScaleFactor: 2 });

const returningVisitor = (page: Page) =>
  page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);

/** Constructed postings (no real company). */
const posting = (n: number, company: string) => ({
  id: `55555555-0000-4000-8000-00000000000${n}`,
  title: "Technical Account Manager",
  company,
  company_domain: null,
  location: "Remote",
  work_type: "remote",
  employment_type: "full_time",
  experience_level: "senior",
  tags: [],
  apply_url: "https://example.com/apply",
  source: "journey",
  posted_at: new Date(Date.now() - 86_400_000).toISOString(),
  vacancy_status: "open",
  ghost_badge: "unscored",
});

async function listedRows(page: Page) {
  await returningVisitor(page);
  const hits = [posting(1, "Maple Relay"), posting(2, "Prairie Stack"), posting(3, "Birch Cloud")];
  await page.route("**/api/jobs/search", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ hits, total: hits.length, backend: "meilisearch", configured: true, searchId: "journey-ring" }) }),
  );
  await page.goto("/jobs?q=nurse");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 45_000 });
}

/** Keyboard modality first, so `:focus-visible` matches, then focus the row. */
async function focusByKeyboard(page: Page, row: Locator) {
  await page.keyboard.press("Shift");
  await row.focus();
  expect(await row.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
}

test("the selected row's 1px ring is whole on all four edges, with the divider still under it", { tag: ["@J-JOBS-161"] }, async ({ page, diagnostics }) => {
  await listedRows(page);
  const selected = page.locator('[data-testid="job-row"][aria-current="true"]');
  await expect(selected).toHaveCount(1, { timeout: 20_000 });
  await page.waitForTimeout(500); // the tint's 150 ms colour transition
  const m = await edgeMatch(page, selected, "--brand-muted", 1);
  expect(brokenEdges(m), `edges of the selected row's ring that are not the ring colour: ${JSON.stringify(m)}`).toEqual([]);
  // The divider is still there: the text column keeps its bottom border.
  expect(await selected.locator("div.border-b").first().evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("1px");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("negative control: the sampler reports the break when a child's border paints over an inset box-shadow ring", { tag: ["@J-JOBS-161"] }, async ({ page }) => {
  await listedRows(page);
  const selected = page.locator('[data-testid="job-row"][aria-current="true"]');
  await expect(selected).toHaveCount(1, { timeout: 20_000 });
  // Put the old mechanism back on the row: the ring as an inset box-shadow, which paints before the divider child.
  await selected.evaluate((el) => {
    el.style.outline = "none";
    el.style.boxShadow = "inset 0 0 0 1px rgb(var(--brand-muted))";
  });
  const m = await edgeMatch(page, selected, "--brand-muted", 1);
  expect(m.bottom, `a ring under the divider must read as broken: ${JSON.stringify(m)}`).toBeLessThan(90);
  expect(m.top).toBeGreaterThanOrEqual(98);
});

test("a keyboard-focused row's 2px focus ring is whole on all four edges", { tag: ["@J-JOBS-162"] }, async ({ page }) => {
  await listedRows(page);
  const row = page.getByTestId("job-row").nth(1); // not the selected one: its outline is the focus ring alone
  await focusByKeyboard(page, row);
  const m = await edgeMatch(page, row, "--live", 2);
  expect(brokenEdges(m), `edges of the focus ring that are not the ring colour: ${JSON.stringify(m)}`).toEqual([]);
});

test("a focused History row's focus ring is whole on all four edges", { tag: ["@J-JOBS-162"] }, async ({ page, baseURL }) => {
  test.skip(!isLocalOrigin(baseURL), "/mock/history is a design fixture, not served on production");
  await returningVisitor(page);
  await page.goto("/mock/history");
  const row = page.getByTestId("history-row").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await focusByKeyboard(page, row);
  const m = await edgeMatch(page, row, "--live", 2);
  expect(brokenEdges(m), `edges of the focus ring that are not the ring colour: ${JSON.stringify(m)}`).toEqual([]);
});
