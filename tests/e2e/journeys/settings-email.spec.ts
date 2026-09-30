import { expect, test } from "./fixtures";

/**
 * Journeys for the account-email confirmation link's landing on Settings — see
 * tests/journeys/CATALOG.md (J-SETTINGS-31). Read-only.
 *
 * /settings is gated by the server session, which a spec can't mint.
 * `/mock/settings` renders the unmodified SettingsContainer behind the
 * dev-only `window.__INTERVU_E2E_AUTH__` user, so this spec runs against a
 * local dev server and skips itself against any other origin.
 */

test.beforeEach(({ baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "signed-in settings need the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
});

test("the account email link says on Settings whether it worked", { tag: ["@J-SETTINGS-31"] }, async ({ page, diagnostics }) => {
  await page.goto("/mock/settings?tab=account&email_confirmed=1");
  const notice = page.getByTestId("landing-notice");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveAttribute("data-tone", "success");
  await expect(notice).toContainText("Email confirmed and added to your account.");
  await expect.poll(() => new URL(page.url()).searchParams.has("email_confirmed")).toBe(false);
  expect(new URL(page.url()).searchParams.get("tab")).toBe("account");

  await page.goto("/mock/settings?tab=account&email_confirmed=0");
  await expect(notice).toHaveAttribute("data-tone", "error", { timeout: 30_000 });
  await expect(notice).toContainText("That confirmation link has expired or was already used.");
  expect(diagnostics.pageErrors).toEqual([]);
});
