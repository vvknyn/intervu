import { mergeTests } from "@playwright/test";
import { test as signedInOnly } from "../helpers/auth-gate";
import { AUTH_RETRY_BUTTON_LABEL, AUTH_RETRY_HEADLINE } from "../../../src/lib/auth/auth-retry-copy";
import { expect, test } from "./fixtures";

/**
 * Journeys for a failed sign-in callback: /auth/retry?reason=exchange_failed is
 * where /auth/callback sends every failed exchange (J-AUTH-27, J-AUTH-41) — and
 * where a visitor who is ALREADY signed in must never be left (J-AUTH-42).
 *
 * Read-only. fixtures.ts blocks analytics, and the /auth/start hop is fulfilled
 * locally so nothing reaches WorkOS.
 */

test("failed callback shows the retry page", { tag: ["@J-AUTH-27"] }, async ({ page }) => {
  await page.goto("/auth/retry?reason=exchange_failed");
  await expect(page.getByRole("heading", { level: 1, name: AUTH_RETRY_HEADLINE })).toBeVisible();
  await expect(page.getByRole("link", { name: AUTH_RETRY_BUTTON_LABEL })).toBeVisible();
});

test("Start again restarts sign-in at /auth/start", { tag: ["@J-AUTH-41"] }, async ({ page }) => {
  await page.route("**/auth/start**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>auth start</body></html>" }),
  );
  await page.goto("/auth/retry?reason=exchange_failed");
  await page.getByRole("link", { name: AUTH_RETRY_BUTTON_LABEL }).click();
  await page.waitForURL("**/auth/start**");
  await expect(page.locator("body")).toHaveText("auth start");
});

// Needs a real session (E2E_STORAGE_STATE); skipped without one — see helpers/auth-gate.ts.
const signedInTest = mergeTests(test, signedInOnly);
signedInTest("a signed-in visitor on the retry page is sent on, not shown the error", { tag: ["@J-AUTH-42"] }, async ({ page }) => {
  await page.goto("/auth/retry?reason=exchange_failed");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/retry"));
  await expect(page.getByRole("heading", { name: AUTH_RETRY_HEADLINE })).toHaveCount(0);
});
