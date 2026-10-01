import type { Page, Request } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for a password signup the server refuses. Incident (2026-10-01, PostHog
 * replay of a real visitor on /jobs?q=Remote+Frontend+Developer): the first Create
 * account press came back "Failed to create account"; every retry resent the same,
 * already-spent Turnstile token, and the sixth press met "Too many attempts".
 *
 * Read-only: the refusals used here happen before any account is created — a
 * disposable email is refused before the rate limit, Turnstile or WorkOS run, and a
 * short password never leaves the browser. api.js is stubbed, so nothing reaches
 * Cloudflare.
 */

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SKIP_REASON = "NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset in this build — the widget renders nothing";

/** A disposable domain: refused by the server's first, local email check. */
const DISPOSABLE_EMAIL = "journey-check@mailinator.com";
const LONG_ENOUGH_PASSWORD = "violet kettle 42";

/**
 * A stand-in api.js whose widget passes at once with "journey-tok-1", and hands out
 * "journey-tok-2", "-3"… on each `turnstile.reset()`, as the real one fetches a new
 * token. Returns whether the page ever asked for api.js (a site key is in the build).
 */
async function stubPassingTurnstile(page: Page): Promise<() => boolean> {
  let requested = false;
  await page.route(TURNSTILE_API, (route) => {
    requested = true;
    return route.fulfill({
      contentType: "application/javascript",
      body: `(function () {
        var issued = 0, widgets = {};
        function issue(o) { setTimeout(function () { issued += 1; o.callback("journey-tok-" + issued); }, 20); }
        window.turnstile = {
          render: function (el, o) { widgets.w1 = o; issue(o); return "w1"; },
          reset: function (id) { if (widgets[id]) issue(widgets[id]); },
          remove: function (id) { delete widgets[id]; },
        };
      })();`,
    });
  });
  return () => requested;
}

/** Signup server-action POSTs, in order: a Next-Action header and this form's email in the body (the page makes other action calls). */
function collectSignupPosts(page: Page): Request[] {
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"]) return;
    if ((request.postData() ?? "").includes(DISPOSABLE_EMAIL)) posts.push(request);
  });
  return posts;
}

async function openSignup(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
}

async function fillSignup(page: Page, password: string) {
  await page.getByLabel("Email").fill(DISPOSABLE_EMAIL);
  await page.getByLabel("Username").fill("journeycheck");
  await page.getByLabel("Password", { exact: true }).fill(password);
}

test("signup with a disposable email shows the email-quality message", { tag: ["@J-AUTH-47"] }, async ({ page }) => {
  await stubPassingTurnstile(page);
  await openSignup(page);
  await fillSignup(page, LONG_ENOUGH_PASSWORD);
  await page.getByTestId("auth-submit-button").click();

  await expect(page.getByRole("alert").filter({ hasText: "Disposable email addresses aren't accepted" })).toBeVisible();
});

test("a refused signup asks for a fresh security check, so the retry never resends the spent token", { tag: ["@J-AUTH-51"] }, async ({ page }) => {
  const requested = await stubPassingTurnstile(page);
  const posts = collectSignupPosts(page);
  await openSignup(page);
  await fillSignup(page, LONG_ENOUGH_PASSWORD);

  const submit = page.getByTestId("auth-submit-button");
  const refusal = page.getByRole("alert").filter({ hasText: "Disposable email addresses aren't accepted" });
  await submit.click();
  await expect(refusal).toBeVisible();
  test.skip(!requested(), SKIP_REASON);

  await submit.click();
  await expect.poll(() => posts.length).toBe(2);
  await expect(refusal).toBeVisible();

  const bodies = posts.map((p) => p.postData() ?? "");
  expect(bodies[0]).toContain("journey-tok-1");
  expect(bodies[1]).toContain("journey-tok-2");
  expect(bodies[1]).not.toContain("journey-tok-1");
  await expect(page.getByText(/Too many/)).toHaveCount(0);
});

test("a password shorter than the rule is stopped on the form, with the rule shown under the field", { tag: ["@J-AUTH-52"] }, async ({ page }) => {
  await stubPassingTurnstile(page);
  const posts = collectSignupPosts(page);
  await openSignup(page);

  await expect(page.getByText("10+ characters, not a common or reused password.")).toBeVisible();
  await expect(page.getByText("6+ characters")).toHaveCount(0);

  await fillSignup(page, "nine-char");
  await page.getByTestId("auth-submit-button").click();

  await expect(page.getByRole("alert").filter({ hasText: "Use at least 10 characters for your password." })).toBeVisible();
  expect(posts, "nothing was sent: no token or rate-limit slot spent").toHaveLength(0);
});
