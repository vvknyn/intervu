import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { signedInTest as test } from "./signed-in";

/**
 * J-NAV-49. The signed-in header is one frame: the logo, the primary nav and
 * the avatar stay at the same x on Jobs, Résumé and Tracker, and the page
 * shell under them uses that same row. Jobs used to opt out (`data-shell="bleed"`),
 * so at 1440 the logo sat at 40px on Jobs and 120px on the other two.
 *
 * Read-only. The signed-in chrome needs the dev-only auth hook, so the spec
 * skips against any other origin (see signed-in.ts).
 */

const ROUTES = ["/jobs", "/resume", "/yours"] as const;

interface ChromeX {
  logo: number | null;
  nav: number | null;
  avatar: number | null;
  /** Header row and the page's shell-row: same left and width, or the content edge has drifted from the logo. */
  headerLeft: number | null;
  headerWidth: number | null;
  pageLeft: number | null;
  pageWidth: number | null;
}

async function readChrome(page: Page): Promise<ChromeX> {
  await expect(page.getByTestId("topbar-logo")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("topbar-avatar")).toBeVisible();
  // Both navs are in the DOM; the desktop tabs are CSS-hidden below lg and the
  // phone bar is CSS-hidden from lg up. `visible=true` is the one on screen.
  const nav = page.locator('[data-testid="topbar-jobs"], [data-testid="mobile-topbar-jobs"]').locator("visible=true");
  await expect(nav.first()).toBeVisible();
  return page.evaluate(() => {
    const xOf = (sel: string) => {
      const el = [...document.querySelectorAll(sel)].find((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      return el ? Math.round(el.getBoundingClientRect().x) : null;
    };
    const box = (el: Element | null) => {
      if (!el) return { left: null, width: null };
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    };
    const wide = window.innerWidth >= 1024;
    const header = box(document.querySelector('[data-testid="topbar"] [data-region="header"]'));
    const pageRow = box(document.querySelector("main .shell-row"));
    return {
      logo: xOf('[data-testid="topbar-logo"]'),
      nav: xOf(wide ? '[data-testid="topbar-jobs"]' : '[data-testid="mobile-topbar-jobs"]'),
      avatar: xOf('[data-testid="topbar-avatar"]'),
      headerLeft: header.left,
      headerWidth: header.width,
      pageLeft: pageRow.left,
      pageWidth: pageRow.width,
    };
  });
}

test("the header logo, nav and avatar hold one x on Jobs, Résumé and Tracker", { tag: ["@J-NAV-49"] }, async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 844 : 900 });
  const shots: Record<string, ChromeX> = {};
  for (const path of ROUTES) {
    await page.goto(path);
    shots[path] = await readChrome(page);
  }
  const jobs = shots["/jobs"];
  expect(jobs.logo, "logo measured").not.toBeNull();
  expect(jobs.nav, "nav measured").not.toBeNull();
  expect(jobs.avatar, "avatar measured").not.toBeNull();
  expect(jobs.pageLeft, "Jobs shell left edge is the header's").toBe(jobs.headerLeft);
  expect(jobs.pageWidth, "Jobs shell width is the header's").toBe(jobs.headerWidth);
  for (const path of ["/resume", "/yours"] as const) {
    expect(shots[path], `${path} vs /jobs`).toEqual(jobs);
  }
});
