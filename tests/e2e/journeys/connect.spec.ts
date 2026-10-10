import type { Page } from "@playwright/test";
import { authCardCopy } from "../../../src/lib/auth/auth-gate-copy";
import { AGENT_PERMISSIONS, AGENT_PERMISSIONS_LIMITS, CONNECT_SAMPLE_PROMPTS } from "../../../src/lib/agent/permissions-copy";
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

test("Sample prompts asks only for what a connected AI's tools return", { tag: ["@J-CONNECT-29"] }, async ({ page }) => {
  await page.goto("/connect");
  await page.getByRole("button", { name: "Sample prompts" }).click();
  for (const prompt of CONNECT_SAMPLE_PROMPTS) await expect(page.getByText(prompt.text, { exact: true })).toBeVisible();
  await expect(page.getByText(/interview insights/i)).toHaveCount(0);
});

/** Every MCP tool: the permission lines name each one exactly once (tests/unit/agent-permissions-copy.test.ts). */
const MCP_TOOLS = AGENT_PERMISSIONS.flatMap((p) => p.tools);

test("An MCP call with no token gets a 401 that points at the server's metadata", { tag: ["@J-OAUTH-12"] }, async ({ request }) => {
  const res = await request.get("/api/mcp");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(res.headers()["www-authenticate"]).toMatch(/^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource"$/);
});

test("The 401's resource_metadata names /api/mcp and its authorization server", { tag: ["@J-OAUTH-21"] }, async ({ request }) => {
  const challenge = (await request.get("/api/mcp")).headers()["www-authenticate"] ?? "";
  const metadataUrl = new URL(challenge.match(/resource_metadata="([^"]+)"/)?.[1] ?? "");
  const res = await request.get(metadataUrl.pathname);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { resource?: string; authorization_servers?: string[] };
  expect(body.resource).toMatch(/\/api\/mcp$/);
  expect(body.authorization_servers?.length).toBeGreaterThan(0);
});

test("/llms.txt lists every MCP tool the server registers and says what fit_label is", { tag: ["@J-OAUTH-17"] }, async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  const listed = [...text.matchAll(/^- ([a-z_]+) — /gm)].map((m) => m[1]);
  expect(new Set(listed)).toEqual(new Set(MCP_TOOLS));
  expect(text).toContain("/api/mcp");
  // The label a connected AI repeats is the one the site shows (mcp-tool-specs.ts FIT_FIELDS_NOTE).
  expect(text).toContain("fit_label");
  expect(text).toContain("Country unclear");
  // What the job pane and the extension show besides the label: the posting's last check, and the résumé's gaps.
  expect(text).toContain("last_checked_at");
  expect(text).toContain("missing_terms");
});
