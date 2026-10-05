import { sealData } from "iron-session";
import { expect, test } from "./fixtures";
import {
  EMAIL_CODE_EXPIRED_BUTTON_LABEL,
  EMAIL_CODE_EXPIRED_HEADLINE,
  EMAIL_CODE_FIELD_LABEL,
  EMAIL_CODE_FORMAT_MESSAGE,
  EMAIL_CODE_HEADLINE,
  EMAIL_CODE_RESEND_LABEL,
  EMAIL_CODE_SUBMIT_LABEL,
  emailCodeBody,
} from "../../../src/lib/auth/email-code-copy";
import { AUTH_RETRY_HEADLINE } from "../../../src/lib/auth/auth-retry-copy";
import { EMAIL_CODE_COOKIE_NAME, EMAIL_CODE_PATH, EMAIL_CODE_TTL_SECONDS } from "../../../src/lib/auth/email-code-pending";

/**
 * Journeys for a Google sign-in WorkOS holds for an emailed code
 * (`email_verification_required`): /auth/callback sends it to
 * /auth/verify-email, not to "We couldn't finish signing you in" (2026-10-04
 * replay: Apply on a Clinical Dietitian role, from a phone).
 *
 * Read-only: no code reaches WorkOS (the one submit below is refused on the
 * page for its format), and the /auth/start hop is fulfilled locally.
 *
 * J-AUTH-54 stands in for the callback's hold with the same sealed cookie the
 * callback writes, so it needs the server's WORKOS_COOKIE_PASSWORD in the test
 * env (a local or staging build); it skips without it, as on prod.
 */

const JOB_PATH = "/jobs?company=diaverum.com&job=be51670d-7b9d-4e6e-bb8d-ae1c8a49616a";

test("a held Google sign-in asks for the emailed code, with any refusal above the box", { tag: ["@J-AUTH-54"] }, async ({ page, baseURL }) => {
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  test.skip(!password, "needs WORKOS_COOKIE_PASSWORD to seal a held sign-in like /auth/callback does");
  const origin = new URL(baseURL ?? "http://localhost:3000");
  const sealed = await sealData(
    { pendingAuthenticationToken: "pat_journey", email: "journey@example.com", next: JOB_PATH },
    { password: password!, ttl: EMAIL_CODE_TTL_SECONDS },
  );
  await page.context().addCookies([
    {
      name: EMAIL_CODE_COOKIE_NAME,
      value: sealed,
      domain: origin.hostname,
      path: "/auth",
      httpOnly: true,
      secure: origin.protocol === "https:",
      sameSite: "Lax",
    },
  ]);

  await page.goto(EMAIL_CODE_PATH);
  await expect(page).toHaveURL(new RegExp(`${EMAIL_CODE_PATH}$`));
  await expect(page.getByRole("heading", { level: 1, name: EMAIL_CODE_HEADLINE })).toBeVisible();
  await expect(page.getByText(emailCodeBody("journey@example.com"))).toBeVisible();
  await expect(page.getByRole("heading", { name: AUTH_RETRY_HEADLINE })).toHaveCount(0);

  const resend = page.getByRole("link", { name: EMAIL_CODE_RESEND_LABEL });
  const resendUrl = new URL((await resend.getAttribute("href"))!, origin);
  expect(resendUrl.pathname).toBe("/auth/start");
  expect(resendUrl.searchParams.get("provider")).toBe("GoogleOAuth");
  expect(resendUrl.searchParams.get("next")).toBe(JOB_PATH);

  const box = page.getByLabel(EMAIL_CODE_FIELD_LABEL);
  await expect(box).toHaveAttribute("autocomplete", "one-time-code");
  await box.fill("12");
  await page.getByRole("button", { name: EMAIL_CODE_SUBMIT_LABEL }).click();
  const message = page.getByTestId("email-code-message");
  await expect(message).toHaveText(EMAIL_CODE_FORMAT_MESSAGE);
  await expect(message).toBeInViewport();
  const [messageBox, fieldBox] = await Promise.all([message.boundingBox(), box.boundingBox()]);
  expect(messageBox!.y).toBeLessThan(fieldBox!.y);
  await expect(box).toBeVisible();
});

test("with nothing held, the code step says it expired and Start again restarts Google sign-in", { tag: ["@J-AUTH-55"] }, async ({ page }) => {
  await page.route("**/auth/start**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>auth start</body></html>" }),
  );
  await page.goto(EMAIL_CODE_PATH);
  await expect(page).toHaveURL(new RegExp(`${EMAIL_CODE_PATH}$`));
  await expect(page.getByRole("heading", { level: 1, name: EMAIL_CODE_EXPIRED_HEADLINE })).toBeVisible();
  await expect(page.getByLabel(EMAIL_CODE_FIELD_LABEL)).toHaveCount(0);

  await page.getByRole("link", { name: EMAIL_CODE_EXPIRED_BUTTON_LABEL }).click();
  await page.waitForURL("**/auth/start**");
  expect(new URL(page.url()).searchParams.get("provider")).toBe("GoogleOAuth");
  await expect(page.locator("body")).toHaveText("auth start");
});
