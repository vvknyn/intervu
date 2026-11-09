import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journey J-CONTENT-42: the accessibility statement. Read-only.
 *
 * The page promises things ("partially conformant", "no outside auditor", a way to
 * report a problem, the gaps we know of), so the journey reads those promises back
 * off the page and then holds the page itself to the standard it states: an axe run
 * over WCAG 2.0 to 2.2 A and AA finds nothing on it.
 */

const AXE_PATH = path.join(__dirname, "../../../node_modules/axe-core/axe.min.js");

async function wcagViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
}

test("the footer links the accessibility statement from the board and from a marketing page", { tag: ["@J-CONTENT-42"] }, async ({ page }) => {
  for (const from of ["/jobs", "/pricing"]) {
    await page.goto(from);
    // Phones fold the footer into sections that stay in the page; the link is there either way.
    await expect(page.locator('footer a[href="/accessibility"]').first()).toBeAttached({ timeout: 20_000 });
  }
  await page.goto("/pricing");
  await page.locator('footer a[href="/accessibility"]').first().evaluate((a: HTMLAnchorElement) => a.click());
  await expect(page).toHaveURL(/\/accessibility$/);
});

test("the statement says where velai stands, what is not yet right, and how to report a problem", { tag: ["@J-CONTENT-42"] }, async ({ page }) => {
  const res = await page.goto("/accessibility");
  expect(res?.status()).toBe(200);

  const doc = page.getByTestId("accessibility-page");
  await expect(doc.getByRole("heading", { level: 1, name: "Accessibility statement" })).toBeVisible();
  await expect(doc).toContainText("WCAG");
  await expect(doc).toContainText("2.2");
  await expect(doc).toContainText("partially conformant");
  await expect(doc).toContainText("no outside auditor has reviewed the site");
  for (const heading of ["Where we stand", "How we check", "Known gaps", "Tell us when something stops you"]) {
    await expect(doc.getByRole("heading", { name: heading })).toBeAttached();
  }
  await expect(doc.locator('a[href^="mailto:"]').first()).toBeAttached();
  await expect(doc.locator('a[href="/contact"]').first()).toBeAttached();

  // Names itself as the canonical, and is open to search engines.
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(new URL(canonical!).pathname).toBe("/accessibility");
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
});

test("the statement page itself passes axe at WCAG 2.2 A and AA", { tag: ["@J-CONTENT-42"] }, async ({ page }) => {
  await page.goto("/accessibility");
  await expect(page.getByTestId("accessibility-page")).toBeVisible();
  expect(await wcagViolations(page)).toEqual([]);
});
