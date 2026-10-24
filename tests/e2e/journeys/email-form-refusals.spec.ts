import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Journeys for the one-shot email forms refusing a submit: the OpenClaw
 * waitlist on /connect. Sibling of
 * signup-refusals.spec.ts: the 2026-10-01 replay showed a refusal nobody saw
 * (rendered below the fold) and a vague "Too many attempts". These forms said
 * the same line; a refusal now says what to do and sits in view under the
 * button on every press.
 *
 * Read-only: "journey-check@example" passes the browser's email check but not
 * the server's, which refuses it before any limit, Turnstile or Firestore.
 * api.js is stubbed, so nothing reaches Cloudflare.
 */

const TURNSTILE_API = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const MALFORMED_EMAIL = "journey-check@example";
const INVALID_EMAIL_MESSAGE = "Enter a full email address, like you@example.com.";

/** A stand-in api.js whose widget passes at once, so the form never waits on a real challenge. */
async function stubPassingTurnstile(page: Page) {
  await page.route(TURNSTILE_API, (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile = {
        render: function (el, o) { setTimeout(function () { o.callback("journey-tok"); }, 20); return "w1"; },
        reset: function () {},
        remove: function () {},
      };`,
    }),
  );
}

/** Resolves when the server has answered this form's next action POST. */
function nextAnswer(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && !!r.request().headers()["next-action"] && (r.request().postData() ?? "").includes(MALFORMED_EMAIL),
  );
}

/** Press twice; both times the refusal reads `message`, is fully in view, and sits right under the button. */
async function expectRefusalUnderButton(page: Page, button: Locator, refusal: Locator, message: string) {
  for (const press of [1, 2]) {
    const answered = nextAnswer(page);
    await button.click();
    await answered;
    await expect(refusal, `press ${press}`).toHaveText(message);
    await expect(refusal, `press ${press}: in view`).toBeInViewport({ ratio: 1 });
    const [buttonBox, refusalBox] = await Promise.all([button.boundingBox(), refusal.boundingBox()]);
    const gap = refusalBox!.y - (buttonBox!.y + buttonBox!.height);
    expect(gap, `press ${press}: right under the button`).toBeGreaterThanOrEqual(0);
    expect(gap, `press ${press}: right under the button`).toBeLessThan(24);
  }
  await expect(page.getByText(/Too many attempts|try again in a few minutes/i)).toHaveCount(0);
}

test("a malformed email on /connect's OpenClaw waitlist is refused in plain words, under Notify me, on every press", { tag: ["@J-CONNECT-19"] }, async ({ page, diagnostics }) => {
  await stubPassingTurnstile(page);
  await page.goto("/connect");
  const notify = page.getByRole("button", { name: "Notify me" });
  await expect(notify).toBeVisible({ timeout: 15_000 });
  const form = page.locator("form").filter({ has: notify });

  await form.getByLabel("Email address").fill(MALFORMED_EMAIL);
  await expectRefusalUnderButton(page, notify, page.getByTestId("openclaw-waitlist-error"), INVALID_EMAIL_MESSAGE);
  await expect(page.getByTestId("openclaw-waitlist-success")).toHaveCount(0);
  expect(diagnostics.serverErrors).toEqual([]);
});
