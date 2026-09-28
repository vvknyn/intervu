import { test, expect, type Page } from "@playwright/test";
import { test as signedInTest, expect as signedInExpect } from "../helpers/auth-gate";
import { AUTH_RETRY_BUTTON_LABEL, AUTH_RETRY_HEADLINE } from "../../../src/lib/auth/auth-retry-copy";
import { POSTHOG_PROXY_PATH } from "../../../src/lib/posthog-options";

/**
 * Journeys for a failed sign-in callback: /auth/retry?reason=exchange_failed is
 * where /auth/callback sends every failed exchange (J-AUTH-01/02) — and where a
 * visitor who is ALREADY signed in must never be left (J-AUTH-03).
 *
 * Read-only. Analytics is blocked so a regression run pollutes no PostHog data,
 * and the /auth/start hop is fulfilled locally so nothing reaches WorkOS.
 */

async function blockAnalytics(page: Page) {
    await page.route(
        (url) => url.pathname.startsWith(`${POSTHOG_PROXY_PATH}/`) || url.pathname === "/api/telemetry",
        (route) => route.abort(),
    );
}

test.describe("signed out", () => {
    test.beforeEach(async ({ page }) => blockAnalytics(page));

    test("failed callback shows the retry page", { tag: ["@J-AUTH-01"] }, async ({ page }) => {
        await page.goto("/auth/retry?reason=exchange_failed");
        await expect(page.getByRole("heading", { level: 1, name: AUTH_RETRY_HEADLINE })).toBeVisible();
        await expect(page.getByRole("link", { name: AUTH_RETRY_BUTTON_LABEL })).toBeVisible();
    });

    test("Start again restarts sign-in at /auth/start", { tag: ["@J-AUTH-02"] }, async ({ page }) => {
        await page.route("**/auth/start**", (route) =>
            route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>auth start</body></html>" }),
        );
        await page.goto("/auth/retry?reason=exchange_failed");
        await page.getByRole("link", { name: AUTH_RETRY_BUTTON_LABEL }).click();
        await page.waitForURL("**/auth/start**");
        await expect(page.locator("body")).toHaveText("auth start");
    });
});

// Needs a real session (E2E_STORAGE_STATE); skipped without one — see helpers/auth-gate.ts.
signedInTest("a signed-in visitor on the retry page is sent on, not shown the error", { tag: ["@J-AUTH-03"] }, async ({ page }) => {
    await blockAnalytics(page);
    await page.goto("/auth/retry?reason=exchange_failed");
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/retry"));
    await signedInExpect(page.getByRole("heading", { name: AUTH_RETRY_HEADLINE })).toHaveCount(0);
});
