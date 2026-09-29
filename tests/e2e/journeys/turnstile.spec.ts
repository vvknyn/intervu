import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for a Turnstile challenge that cannot run. Incident (Sep 28): Cloudflare
 * error 110200 ("domain not authorized") left the widget on "Unable to connect" on
 * every velai form while signups silently died. The one wrapper
 * (src/components/ui/turnstile-widget.tsx) must now say so and offer a way forward.
 *
 * Read-only: api.js is stubbed (or aborted) locally, so nothing reaches Cloudflare and
 * nothing is submitted. These need a build with NEXT_PUBLIC_TURNSTILE_SITE_KEY set —
 * without one the widget renders nothing, and the test skips with that reason.
 */

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SKIP_REASON = "NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset in this build — the widget renders nothing";

/**
 * Route api.js: `code` stubs a script whose `render` fires the widget's error-callback
 * with that code; null aborts the request (blocked or offline). Returns whether the
 * page ever asked for api.js, i.e. whether the build has a site key at all.
 */
async function failTurnstile(page: Page, code: string | null): Promise<() => boolean> {
  let requested = false;
  await page.route(TURNSTILE_API, (route) => {
    requested = true;
    if (code === null) return route.abort();
    return route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = { render: function (el, o) { setTimeout(function () { o["error-callback"]("${code}"); }, 0); return "w1"; }, remove: function () {} };`,
    });
  });
  return () => requested;
}

/** Waits for the wrapper's notice, skipping when the build never loads Turnstile. */
async function expectNotice(page: Page, requested: () => boolean) {
  const notice = page.getByTestId("turnstile-error");
  await notice.waitFor({ timeout: 15_000 }).catch(() => {});
  test.skip(!requested(), SKIP_REASON);
  await expect(notice).toBeVisible();
  return notice;
}

async function openSignupTab(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
}

test("a failed Turnstile on signup shows the message and Google / email-code paths", { tag: ["@J-AUTH-43"] }, async ({ page }) => {
  const requested = await failTurnstile(page, "110200");
  await openSignupTab(page);
  await expectNotice(page, requested);

  const fallback = page.getByTestId("turnstile-fallback");
  await expect(fallback.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(fallback.getByRole("button", { name: "Use email code" })).toBeVisible();
});

test("a Turnstile script that never loads shows the same fallback", { tag: ["@J-AUTH-44"] }, async ({ page }) => {
  const requested = await failTurnstile(page, null);
  await openSignupTab(page);
  await expectNotice(page, requested);

  await expect(page.getByTestId("turnstile-fallback").getByRole("button", { name: "Use email code" })).toBeVisible();
});

test("a failed Turnstile on /contact says to reload and invents no alternative path", { tag: ["@J-CONTENT-24"] }, async ({ page }) => {
  const requested = await failTurnstile(page, "300030");
  await page.goto("/contact");
  const notice = await expectNotice(page, requested);

  await expect(notice).toContainText("Reload the page");
  await expect(page.getByTestId("turnstile-fallback")).toHaveCount(0);
});
