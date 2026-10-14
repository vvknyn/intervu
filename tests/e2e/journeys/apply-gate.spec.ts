import type { Page } from "@playwright/test";
import { ONBOARDING_COMPLETED_STORAGE_KEY } from "../../../src/lib/jobs/onboarding-first-paint";
import { authCardCopy, authGateTitle } from "../../../src/lib/auth/auth-gate-copy";
import { APPLY_BUTTON_LABEL, APPLY_SIGNED_OUT_LABEL } from "../../../src/components/jobs/job-detail-facts";
import { expect, test } from "./fixtures";
import { runSearch } from "./search-box";

/**
 * A guest's Apply on a job page — see tests/journeys/CATALOG.md (J-APPLY-*).
 * Read-only: the job comes from live search, the dialog is only opened and
 * closed, and every hop to /auth/start is answered here, so nothing reaches
 * WorkOS.
 */

const APPLY_TITLE = authGateTitle("apply")!;

/** Search, then open the first result's own job page. Returns its path. */
async function openJobPage(page: Page): Promise<string> {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_STORAGE_KEY);
  await page.goto("/jobs");
  const input = page.getByPlaceholder("Job title, skill, or company");
  await input.fill("engineer");
  await runSearch(page, input);
  const href = await page.getByTestId("job-row").first().locator('a[href^="/jobs/"]').first().getAttribute("href", { timeout: 30_000 });
  const res = await page.goto(href!);
  expect(res?.status()).toBe(200);
  return new URL(page.url()).pathname;
}

// A signed-out visitor's button reads "Sign in to apply" (J-APPLY-11); the label flips once the session check settles.
const applyButton = (page: Page) => page.getByRole("button", { name: /^(apply|sign in to apply)/i }).and(page.locator(":visible")).first();

/** Clicks Apply and returns the sign-in dialog it opens. */
async function openApplyGate(page: Page) {
  let popups = 0;
  page.on("popup", () => popups++);
  await applyButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(APPLY_TITLE, { exact: true }).and(page.locator(":visible")).first()).toBeVisible();
  expect(popups, "no employer tab opens before sign-in").toBe(0);
  return dialog;
}

/** Answers every /auth/start hop here and returns the params of the first. */
async function captureAuthStart(page: Page) {
  let hit: URL | null = null;
  await page.route("**/auth/start**", (route) => {
    hit ??= new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>auth start</body></html>" });
  });
  return () => hit;
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("Apply on a job page opens \"Sign in to apply\", not the employer site", { tag: ["@J-APPLY-01"] }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "J-APPLY-05 covers the phone action bar");
  await openJobPage(page);
  await openApplyGate(page);
});

test("A signed-out visitor's Apply button says \"Sign in to apply\", on the desktop card and the phone's bar", { tag: ["@J-APPLY-11"] }, async ({ page }) => {
  await openJobPage(page);
  const apply = page.getByRole("button", { name: APPLY_SIGNED_OUT_LABEL }).and(page.locator(":visible"));
  await expect(apply).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: APPLY_BUTTON_LABEL })).toHaveCount(0);
});

test("Apply from the phone's sticky action bar opens the same \"Sign in to apply\"", { tag: ["@J-APPLY-05"] }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "J-APPLY-01 covers desktop");
  await openJobPage(page);
  await openApplyGate(page);
});

test("A closed Apply dialog stays closed when the session is checked again, and Apply still opens it", { tag: ["@J-APPLY-29"] }, async ({ page }) => {
  await openJobPage(page);
  const dialog = await openApplyGate(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Coming back to the tab from the back/forward cache re-reads the session
  // and tells every listener, which used to reopen the dialog.
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/session")),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))),
  ]);
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await openApplyGate(page);
});

test("Create account from the Apply dialog comes back to the job page, not the résumé upload", { tag: ["@J-APPLY-30"] }, async ({ page }) => {
  const jobPath = await openJobPage(page);
  const dialog = await openApplyGate(page);
  const authStart = await captureAuthStart(page);

  await dialog.getByRole("tab", { name: authCardCopy("signup").tabLabel }).click();
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL("**/auth/start**");

  const params = authStart()!.searchParams;
  expect(params.get("mode")).toBe("signup");
  expect(params.get("next")).toBe(jobPath);
  // Every sign-up keeps its page now, so nothing has to flag the queued Apply.
  expect(params.get("pending")).toBeNull();
});

test("Continue with Google from the Apply dialog signs in back to the job page", { tag: ["@J-APPLY-03"] }, async ({ page }) => {
  const jobPath = await openJobPage(page);
  const dialog = await openApplyGate(page);
  const authStart = await captureAuthStart(page);

  await dialog.getByRole("tab", { name: authCardCopy("login").tabLabel }).click();
  await dialog.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL("**/auth/start**");

  const params = authStart()!.searchParams;
  expect(params.get("mode")).toBeNull();
  expect(params.get("next")).toBe(jobPath);
});
