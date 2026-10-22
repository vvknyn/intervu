import { expect, test } from "./fixtures";

/**
 * A password sign-in WorkOS holds for an emailed code (`email_verification_required`)
 * opens the code step inside the login card, never a dead "sign in to continue"
 * (2026-10-22: a fresh signup could not get in). Needs an account whose email was
 * never verified; skipped without one, as on prod.
 */
const EMAIL = process.env.JOURNEY_UNVERIFIED_EMAIL;
const PASSWORD = process.env.JOURNEY_UNVERIFIED_PASSWORD;

test("an unverified password sign-in lands on the inline code step", { tag: ["@J-AUTH-57", "@writes"] }, async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "JOURNEY_UNVERIFIED_EMAIL / JOURNEY_UNVERIFIED_PASSWORD are unset");
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD!);
  await page.getByTestId("auth-submit-button").click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await expect(page.getByRole("button", { name: "send a new code" })).toBeVisible();
  await page.getByRole("button", { name: "Use a different account" }).click();
  await expect(page.getByLabel("Email or username")).toBeVisible();
});
