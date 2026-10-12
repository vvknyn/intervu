import path from "node:path";
import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Accessibility checks the focus group's axe run failed (2026-10-12) — see
 * tests/journeys/CATALOG.md (J-JOBS-118, J-TRACKER-74, J-CONTENT-35).
 * Read-only. Each test runs axe-core on one page and asserts the rules that
 * failed there, so an unrelated finding elsewhere doesn't fail it.
 */

const AXE_PATH = path.join(__dirname, "../../../node_modules/axe-core/axe.min.js");

type AxeViolation = { id: string; nodes: { target: string[] }[] };

async function axeViolations(page: Page, rules: string[]): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (ids) => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const res = await axe.run(document, { runOnly: { type: "rule", values: ids } });
    return res.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  }, rules);
}

const summary = (violations: AxeViolation[]) => violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

test("the job results list passes axe: rows are not options holding links, and Clear reads against the toolbar", { tag: ["@J-JOBS-118"] }, async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs?q=nurse&exp=mid");
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("results-clear-filters").and(page.locator(":visible")).first()).toBeVisible();
  const violations = await axeViolations(page, ["nested-interactive", "aria-required-children", "aria-allowed-attr", "aria-prohibited-attr", "color-contrast"]);
  // Contrast is checked on the Clear control the report named; the rest of the page has its own owners.
  const relevant = violations
    .map((v) => (v.id === "color-contrast" ? { ...v, nodes: v.nodes.filter((n) => n.target.join(" ").includes("results-clear-filters")) } : v))
    .filter((v) => v.nodes.length > 0);
  expect(summary(relevant)).toEqual([]);
});

test("the Tracker and History switch is a row of links, with no aria-controls pointing at a missing panel", { tag: ["@J-TRACKER-74"] }, async ({ page }) => {
  await page.goto("/yours");
  const nav = page.getByRole("navigation", { name: "Tracker views" });
  await expect(nav).toBeVisible({ timeout: 15_000 });
  await expect(nav.getByRole("link", { name: "Tracker" })).toHaveAttribute("aria-current", "page");
  expect(summary(await axeViolations(page, ["aria-valid-attr-value"]))).toEqual([]);
  await nav.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/yours\/history/);
  await expect(page.getByRole("navigation", { name: "Tracker views" }).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
});

test("links inside the privacy policy's paragraphs are underlined, not marked by colour alone", { tag: ["@J-CONTENT-35"] }, async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByTestId("privacy-page")).toBeVisible();
  expect(summary(await axeViolations(page, ["link-in-text-block"]))).toEqual([]);
});
