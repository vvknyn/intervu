import { expect, test } from "./fixtures";

/**
 * Journeys for a signed-in account with no résumé on /jobs — see tests/journeys/CATALOG.md
 * (J-AUTH-45). Read-only.
 *
 * The only sign-in a spec can fake is the dev-only `window.__INTERVU_E2E_AUTH__` hook, which a
 * production build ignores, so this runs against a local dev server and skips itself elsewhere.
 * The fake account has no server session, so the résumé presence check answers "none on file".
 * The hook also makes the header hydrate differently from the server render, so page errors are
 * not asserted here.
 */

test.beforeEach(({ baseURL }) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");
  test.skip(!local, "signed-in /jobs needs the dev-only __INTERVU_E2E_AUTH__ hook, which production builds ignore");
});

test("a signed-in account with no résumé lands on the board with the résumé band, not a full-page card", { tag: ["@J-AUTH-45"] }, async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
      uid: "u-no-resume", displayName: "Ada Lovelace", email: "ada@example.com", emailVerified: true, isAnonymous: false,
      providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
    };
  });
  await page.goto("/jobs");
  await expect(page.locator('input[placeholder="Job title, skill, or company"]:visible').first()).toBeVisible({ timeout: 30_000 });
  const band = page.getByRole("region", { name: "Add your resume" });
  await expect(band).toBeVisible();
  await expect(band.getByRole("button", { name: /upload/i })).toBeVisible();
  // Already signed in: the upload goes to their account, and the "Sign in to sync…" line is not for them.
  await expect(band).toContainText("saved to your account");
  await expect(page.getByTestId("front-door-band-signin")).toHaveCount(0);
  await expect(page.getByTestId("landing-onboarding-step-2")).toHaveCount(0);
});
