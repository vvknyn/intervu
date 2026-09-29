import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for alerts on /jobs — see tests/journeys/CATALOG.md (J-ALERTS-22/23). Read-only:
 * the alert form is opened, never submitted.
 *
 * The "since your last visit" line only shows for a visitor with a stored board cursor, so each
 * test plants one from a few days back; the page counts real postings since then and writes a
 * fresh cursor after reading it.
 */

// visit-cursor.ts's storage key for the "board" scope.
const BOARD_CURSOR_KEY = "intervu.visitCursor.board";

const lastVisitDaysAgo = (page: Page, days: number) =>
  page.addInitScript(
    ([key, iso]) => localStorage.setItem(key, iso),
    [BOARD_CURSOR_KEY, new Date(Date.now() - days * 86_400_000).toISOString()],
  );

test("a returning visitor sees how many roles are new since their last visit, and the line stays", { tag: ["@J-ALERTS-22"] }, async ({ page, diagnostics }) => {
  await lastVisitDaysAgo(page, 3);
  await page.goto("/jobs");
  const line = page.getByTestId("board-visit-banner");
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line).toContainText(/[\d,]+\+? new roles? on Velai since your last visit/);
  // It used to be a corner toast that dismissed itself after 6 seconds.
  await page.waitForTimeout(7_000);
  await expect(line).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("Email me new roles beside that line opens the email alert form", { tag: ["@J-ALERTS-23"] }, async ({ page, diagnostics }) => {
  await lastVisitDaysAgo(page, 3);
  await page.goto("/jobs");
  const emailMe = page.getByTestId("board-visit-email");
  await expect(emailMe).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);
  await emailMe.click();
  const form = page.getByTestId("search-alert-capture");
  await expect(form).toBeVisible();
  await expect(form.getByPlaceholder("you@company.com")).toBeVisible();
  await expect(emailMe).toHaveAttribute("aria-expanded", "true");
  expect(diagnostics.pageErrors).toEqual([]);
});
