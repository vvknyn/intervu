import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { INTERACTIONS_KEY } from "../../../src/lib/jobs/onboarding-prompt";
import { SAVED_SEARCHES_KEY } from "../../../src/lib/jobs/saved-searches";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";
import { actionObject, signInLikeProduction } from "./signed-in";

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

test("the visit line carries no email link: the results line's alerts switch is the one alerts control", { tag: ["@J-ALERTS-23"] }, async ({ page, diagnostics }) => {
  await lastVisitDaysAgo(page, 3);
  await page.goto(VISIT_SEARCH);
  const line = page.getByTestId("board-visit-banner");
  await expect(line).toBeVisible({ timeout: 30_000 });
  // "Email me new roles" here, "Get alerts" in the toolbar and "Get new matches by email" on the
  // results line all opened the same form (2026-10-10).
  await expect(line.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("jobs-create-alert-trigger")).toHaveCount(0);
  await expect(page.getByTestId("result-line-get-alerts")).toHaveCount(0);
  await expect(page.getByTestId("search-alert-switch").getByRole("switch")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

test("a guest's Job alert switch opens the email form under it, and stays on for that search once sent", { tag: ["@J-ALERTS-03", "@J-ALERTS-45"] }, async ({ page, diagnostics }) => {
  // Read-only: the alert request is answered in the browser, nothing is sent.
  const requests: string[] = [];
  await page.route("**/api/search-alerts", async (route) => {
    requests.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto(VISIT_SEARCH);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  const control = page.getByTestId("search-alert-switch");
  const toggle = control.getByRole("switch", { name: /job alert/i });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // With results the form no longer opens by itself; only the switch opens it.
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);

  // The words beside the switch flip it too.
  await control.getByText("Job alert", { exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const form = page.getByTestId("search-alert-capture");
  await expect(form).toBeVisible();
  // Right under the switch that opened it, above the first row.
  const [switchBox, formBox, rowBox] = await Promise.all([toggle.boundingBox(), form.boundingBox(), page.getByTestId("job-row").first().boundingBox()]);
  expect(formBox!.y).toBeGreaterThan(switchBox!.y);
  expect(formBox!.y).toBeLessThan(rowBox!.y);

  await form.getByTestId("search-alert-dismiss").click();
  await expect(form).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(page.getByTestId("search-alert-capture")).toContainText("The confirm link also creates your free account.");
  await page.getByTestId("search-alert-email-input").fill("journey@example.com");
  await page.getByTestId("search-alert-submit").click();
  await expect(page.getByTestId("search-alert-capture")).toContainText("Check your inbox to confirm.");
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0]).href).toContain("q=engineer");

  await page.reload();
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // The alert lives under the email address, so off points at the email's own Unsubscribe.
  await toggle.click();
  await expect(control.getByTestId("search-alert-switch-note")).toHaveText("To stop these emails, use Unsubscribe in any alert email.");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("with results, the email form never opens by itself after searches, only from the alerts switch", { tag: ["@J-ALERTS-02"] }, async ({ page, diagnostics }) => {
  // It opened on its own once a guest had searched twice; 34 people saw it in 90 days and none
  // sent it (PostHog, 2026-10-10). The count is seeded past that threshold, then one more search runs.
  await page.addInitScript(
    ([interactionsKey, onboardingKey]) => {
      localStorage.setItem(interactionsKey, "2");
      localStorage.setItem(onboardingKey, "1");
    },
    [INTERACTIONS_KEY, ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.goto(VISIT_SEARCH);
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill("nurse");
  await runSearch(page, input);
  await expect(page).toHaveURL(/[?&]q=nurse/, { timeout: 30_000 });
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);

  const toggle = page.getByTestId("search-alert-switch").getByRole("switch", { name: /job alert/i });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByTestId("search-alert-capture")).toBeVisible();
  expect(diagnostics.pageErrors).toEqual([]);
});

const isLocal = (baseURL: string | undefined) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

const noticeParamGone = (page: Page, param: string) => expect.poll(() => new URL(page.url()).searchParams.has(param)).toBe(false);

// No page-error assertion here: the dev-only signed-in mock itself causes a
// hydration mismatch in the header (server renders signed out), on staging too.
test("a signed-in user never gets the guest email-alert form; the Job alert switch is the alert", { tag: ["@J-ALERTS-09"] }, async ({ page, baseURL }) => {
  test.skip(!isLocal(baseURL), "signed-in /jobs needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
  await page.addInitScript(
    ([key]) => {
      (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = { uid: "u1", displayName: "Ada Lovelace", email: "ada@example.com" };
      localStorage.setItem(key, "1");
    },
    [ONBOARDING_COMPLETED_STORAGE_KEY],
  );
  await page.goto("/jobs?q=engineer");
  await expect(page.getByTestId("search-alert-switch")).toBeVisible({ timeout: 30_000 });
  // The toolbar "Get alerts" opened the guest email form for signed-in users too.
  await expect(page.getByTestId("jobs-create-alert-trigger")).toHaveCount(0);
  await expect(page.getByTestId("result-line-get-alerts")).toHaveCount(0);
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);

  await page.goto("/jobs?q=zzzzqxwv");
  await expect(page.getByTestId("jobs-create-alert-trigger")).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);
});

test("a signed-in person's Job alert saves to the account, not to this browser", { tag: ["@J-ALERTS-46"] }, async ({ page, diagnostics }) => {
  // Signed in the way production signs in, Save search took the guest path
  // and kept the search in this browser only, where the account's list never
  // showed it (founder report 2026-10-01, same cause as the tracker's "Could
  // not find this pursuit."). Lists answer empty; the save is recorded, not written.
  const saves: Record<string, unknown>[] = [];
  await signInLikeProduction(page, (args) => {
    if (args.length === 0) return { data: [] };
    const input = actionObject(args[0]);
    if (args.length === 1 && typeof input.name === "string" && typeof input.href === "string") {
      saves.push(input);
      return { data: { id: "saved-journey", name: input.name, href: input.href } };
    }
    return undefined;
  });
  await page.goto("/jobs?q=engineer");
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
  // Save the search once its results show, as a person would. Next runs a
  // page's server actions one at a time and the search is one, so a save
  // pressed while it loads waits for it: on a phone against prod that wait
  // outran the 5s default (R16 check, 2026-10-01).
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("search-alert-switch").getByRole("switch", { name: /job alert/i }).click();
  await expect
    .poll(() => saves, { timeout: 15_000 })
    .toEqual([expect.objectContaining({ href: expect.stringContaining("q=engineer") })]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVED_SEARCHES_KEY)).toBeNull();
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a signed-in person's Job alert goes out at once while the search is still loading", { tag: ["@J-ALERTS-47"] }, async ({ page, diagnostics }) => {
  // The list search was a Server Action, and Next runs a page's actions one
  // at a time, so a save pressed while a search loaded waited for that search
  // (5s on a phone, 2026-10-01). Here the search answers 12s late; the save
  // must not wait for it.
  const saves: number[] = [];
  await signInLikeProduction(page, (args) => {
    if (args.length === 0) return { data: [] };
    const input = actionObject(args[0]);
    if (args.length === 1 && typeof input.name === "string" && typeof input.href === "string") {
      saves.push(Date.now());
      return { data: { id: "saved-journey", name: input.name, href: input.href } };
    }
    return undefined;
  });
  // Registered after the sign-in routes, so it sees each request first: hold
  // the results search (the one asking for facets), whatever carries it.
  await page.route(
    () => true,
    async (route) => {
      const body = route.request().method() === "POST" ? (route.request().postData() ?? "") : "";
      if (body.includes('"q":"engineer"') && body.includes('"withFacets":true')) {
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
      return route.fallback();
    },
  );
  await page.goto("/jobs?q=engineer");
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("job-row")).toHaveCount(0);
  const pressed = Date.now();
  await page.getByTestId("search-alert-switch").getByRole("switch", { name: /job alert/i }).click();
  await expect.poll(() => saves.length, { timeout: 6_000 }).toBe(1);
  expect(saves[0] - pressed).toBeLessThan(6_000);
  // The held search still lands afterwards.
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("signed in, the Job alert switch saves this search to the account, and off deletes it", { tag: ["@J-ALERTS-48"] }, async ({ page, diagnostics }) => {
  // The switch is the saved search: on saves it (saved searches feed the
  // weekly digest), off deletes it, with no naming step. Writes are answered
  // in the browser, so nothing reaches an account.
  const saves: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  let row: { id: string; name: string; href: string; createdAt: string } | null = null;
  await signInLikeProduction(page, (args) => {
    if (args.length === 0) return { data: row ? [row] : [] };
    // Setup's actions also take one string (the account's uid), so match the saved row's id.
    if (args.length === 1 && args[0] === "saved-journey") {
      deletes.push(args[0]);
      row = null;
      return {};
    }
    const input = actionObject(args[0]);
    if (args.length === 1 && typeof input.name === "string" && typeof input.href === "string") {
      saves.push(input);
      row = { id: "saved-journey", name: input.name, href: input.href, createdAt: new Date().toISOString() };
      return { data: row };
    }
    return undefined;
  });
  await page.goto("/jobs?q=engineer");
  await expect(page.getByTestId("topbar-avatar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("job-row").first()).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId("search-alert-switch").getByRole("switch", { name: /job alert/i });
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect.poll(() => saves, { timeout: 15_000 }).toEqual([expect.objectContaining({ name: "engineer", href: expect.stringContaining("q=engineer") })]);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Signed in there is no email form: the account's address gets the digest.
  await expect(page.getByTestId("search-alert-capture")).toHaveCount(0);
  // Never a second copy in this browser's storage.
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVED_SEARCHES_KEY)).toBeNull();

  await toggle.click();
  await expect.poll(() => deletes, { timeout: 15_000 }).toEqual(["saved-journey"]);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(diagnostics.pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
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
