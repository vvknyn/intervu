import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { expect, test } from "./fixtures";

/**
 * Journeys for alerts on /jobs — see tests/journeys/CATALOG.md (J-ALERTS-*). Read-only:
 * the alert form is opened, never submitted, and the verify links carry bogus tokens,
 * which the routes reject without writing anything.
 *
 * The "since your last visit" line only shows for a visitor with a stored board cursor, so each
 * test plants one from a few days back; the page counts real postings since then and writes a
 * fresh cursor after reading it. The line leads a list of results, and bare /jobs shows none
 * (the front door), so each test searches.
 */

// Broad enough for a full page of rows on prod and on the local corpus.
const VISIT_SEARCH = "/jobs?q=engineer";

// visit-cursor.ts's storage key for the "board" scope.
const BOARD_CURSOR_KEY = "intervu.visitCursor.board";

const lastVisitDaysAgo = (page: Page, days: number) =>
  page.addInitScript(
    ([key, iso]) => localStorage.setItem(key, iso),
    [BOARD_CURSOR_KEY, new Date(Date.now() - days * 86_400_000).toISOString()],
  );

test("a returning visitor who searches sees how many roles are new since their last visit, and the line stays", { tag: ["@J-ALERTS-22"] }, async ({ page, diagnostics }) => {
  await lastVisitDaysAgo(page, 3);
  await page.goto(VISIT_SEARCH);
  // It used to vanish as soon as the search's rows arrived, so check it after they have.
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
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
  await page.goto(VISIT_SEARCH);
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

const isLocal = (baseURL: string | undefined) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

const noticeParamGone = (page: Page, param: string) => expect.poll(() => new URL(page.url()).searchParams.has(param)).toBe(false);

// No page-error assertion here: the dev-only signed-in mock itself causes a
// hydration mismatch in the header (server renders signed out), on staging too.
test("a signed-in user never gets the guest email-alert form; Save search is the alert", { tag: ["@J-ALERTS-09"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "signed-in /jobs needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  await page.addInitScript(
    ([key]) => {
      (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com" };
      localStorage.setItem(key, "1");
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.goto("/jobs?view=search&q=engineer");
  await expect(page.getByTestId("save-search-trigger").first()).toBeVisible({ timeout: 30_000 });
  // The toolbar "Get alerts" opened the guest email form for signed-in users too.
  await expect(page.getByTestId("jobs-create-alert-trigger")).toHaveCount(0);
  await expect(page.getByTestId("result-line-get-alerts")).toHaveCount(0);
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);

  await page.goto("/jobs?view=search&q=zzzzqxwv");
  await expect(page.getByTestId("jobs-create-alert-trigger")).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);
});

test("a search-alert link that fails lands on /jobs saying so, and the flag leaves the URL", { tag: ["@J-ALERTS-11"] }, async ({ page, diagnostics }) => {
  await page.goto("/api/search-alerts/verify?token=bogus");
  const notice = page.getByTestId("landing-notice");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveAttribute("data-tone", "error");
  await expect(notice).toContainText("That alert link has expired or was already used.");
  expect(new URL(page.url()).pathname).toBe("/jobs");
  await noticeParamGone(page, "search_alert");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a search-alert link with no token lands on /jobs saying it failed", { tag: ["@J-ALERTS-12"] }, async ({ page }) => {
  await page.goto("/api/search-alerts/verify");
  await expect(page.getByTestId("landing-notice")).toContainText("That alert link has expired or was already used.", { timeout: 30_000 });
  await noticeParamGone(page, "search_alert");
});

test("a follow link that fails lands on /jobs saying so", { tag: ["@J-ALERTS-28", "@J-COMPANY-17"] }, async ({ page, diagnostics }) => {
  await page.goto("/api/follow-email/verify?token=bogus&domain=anthropic.com&name=Anthropic");
  const notice = page.getByTestId("landing-notice");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveAttribute("data-tone", "error");
  await expect(notice).toContainText("That follow link has expired or was already used.");
  expect(new URL(page.url()).pathname).toBe("/jobs");
  await noticeParamGone(page, "followed");
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a confirmed search alert lands on its search saying so, once", { tag: ["@J-ALERTS-41"] }, async ({ page, diagnostics }) => {
  await page.goto("/jobs?q=engineer&search_alert=1");
  const notice = page.getByTestId("landing-notice");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveAttribute("data-tone", "success");
  await expect(notice).toContainText("Search alert confirmed.");
  await noticeParamGone(page, "search_alert");
  expect(new URL(page.url()).searchParams.get("q")).toBe("engineer");

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("landing-notice")).toHaveCount(0);
  expect(diagnostics.pageErrors).toEqual([]);
});
