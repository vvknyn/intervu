import type { Page } from "@playwright/test";
import { authCardCopy } from "../../../src/lib/auth/auth-gate-copy";
import { AGENT_PERMISSIONS, AGENT_PERMISSIONS_LIMITS } from "../../../src/lib/agent/permissions-copy";
import { expect, test } from "./fixtures";

/**
 * Connecting an AI: /connect and the sign-in in front of the OAuth approval —
 * see tests/journeys/CATALOG.md (J-CONNECT-*, J-OAUTH-*). Read-only: every hop
 * to /auth/start is answered here, so nothing reaches WorkOS.
 */

/** Answers every /auth/start hop here and returns the params of the first. */
async function captureAuthStart(page: Page) {
  let hit: URL | null = null;
  await page.route("**/auth/start**", (route) => {
    hit ??= new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>auth start</body></html>" });
  });
  return () => hit;
}

/** On /login: Create account, then Continue with Google; returns the /auth/start params. */
async function createAccountWithGoogle(page: Page) {
  const authStart = await captureAuthStart(page);
  await page.getByRole("tab", { name: authCardCopy("signup").tabLabel }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.waitForURL("**/auth/start**");
  return authStart()!.searchParams;
}

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("/connect's sign-in step goes to /login and comes back to /connect", { tag: ["@J-CONNECT-02"] }, async ({ page }) => {
  await page.goto("/connect");
  const step = page.getByTestId("connect-signin-step");
  await expect(step.getByText("1.", { exact: true })).toBeVisible();
  await step.getByRole("link").click();
  await page.waitForURL((url) => url.pathname === "/login");
  expect(new URL(page.url()).searchParams.get("next")).toBe("/connect");
});

test("Create account from /connect's sign-in comes back to /connect, not the résumé upload", { tag: ["@J-CONNECT-24"] }, async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent("/connect")}`);
  const params = await createAccountWithGoogle(page);
  expect(params.get("mode")).toBe("signup");
  expect(params.get("next")).toBe("/connect");
});

test("Permissions and privacy lists what a connected AI can read and change", { tag: ["@J-CONNECT-15"] }, async ({ page }) => {
  await page.goto("/connect");
  await page.getByRole("button", { name: "Permissions and privacy" }).click();
  const list = page.getByTestId("connect-permissions");
  await expect(list.getByRole("listitem")).toHaveText(AGENT_PERMISSIONS.map((p) => p.text));
  await expect(page.getByText(AGENT_PERMISSIONS_LIMITS)).toBeVisible();
  await expect(page.getByText("Read-only search")).toHaveCount(0);
});

test("Create account in front of an agent approval comes back to the approval", { tag: ["@J-OAUTH-19"] }, async ({ page }) => {
  const approval =
    "/oauth/authorize?client_id=journey-client&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback" +
    "&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256&response_type=code&state=xyz";
  await page.goto(`/login?next=${encodeURIComponent(approval)}`);
  const params = await createAccountWithGoogle(page);
  expect(params.get("mode")).toBe("signup");
  expect(params.get("next")).toBe(approval);
});
