import type { Page } from "@playwright/test";
import { test as base } from "./fixtures";

/**
 * For you needs an account, so its journeys run signed in.
 *
 * - E2E_STORAGE_STATE set (a storageState file captured from a real sign-in):
 *   the spec runs as that account anywhere, prod included. Use an account with
 *   no résumé on file, so the résumé a spec seeds in this browser is the one
 *   ranked (a signed-in visitor falls back to it when the account has none).
 * - Unset: the spec signs in with the dev-only `window.__INTERVU_E2E_AUTH__`
 *   hook, which only a local dev server honours, and skips on any other origin.
 */
export const SIGNED_IN_SKIP_REASON =
  "For you needs an account: set E2E_STORAGE_STATE, or run against a local dev server (dev-only __INTERVU_E2E_AUTH__ hook)";

export const isLocalOrigin = (baseURL: string | undefined) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

/** Signs the page in with the dev-only hook before any script runs; a local dev server only. */
export const mockSignIn = (page: Page) =>
  page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
      uid: "e2e-packs", displayName: "Sam Rivera", email: "sam.rivera.dev@example.com", emailVerified: true, isAnonymous: false,
      providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
    };
  });

export const signedInTest = base.extend<{ signedIn: void }>({
  storageState: async ({}, use) => {
    await use(process.env.E2E_STORAGE_STATE || undefined);
  },
  signedIn: [
    async ({ page, baseURL }, use) => {
      if (!process.env.E2E_STORAGE_STATE) {
        base.skip(!isLocalOrigin(baseURL), SIGNED_IN_SKIP_REASON);
        await mockSignIn(page);
      }
      await use();
    },
    { auto: true },
  ],
});

/**
 * The dev-only hook signs the browser in before React hydrates, while the
 * server rendered the header signed out, so the header's auth slot logs one
 * hydration mismatch on the first load (on staging too; see modal.spec.ts).
 * Drop exactly that error when the hook is in use, and keep every other page
 * error; a real session (E2E_STORAGE_STATE) keeps them all.
 */
export const withoutMockSignInHydration = (pageErrors: string[]) =>
  process.env.E2E_STORAGE_STATE
    ? pageErrors
    : pageErrors.filter((e) => !(e.startsWith("Hydration failed") && e.includes("topbar-auth-pending")));

/** The account `signInLikeProduction` signs in as. */
export const PRODUCTION_SIGN_IN_ACCOUNT = { uid: "journey-account", email: "ada@example.com", displayName: "Ada Lovelace" };

/** Swaps a server action's return value, keeping the response's own header line (the build id differs per build). */
export function withActionResult(flight: string, value: unknown) {
  const lines = flight.trimEnd().split("\n");
  let at = lines.length - 1;
  while (at > 0 && !(lines[at].startsWith("1:") && !lines[at].startsWith("1:D"))) at--;
  lines[at] = `1:${JSON.stringify(value)}`;
  return `${lines.join("\n")}\n`;
}

/**
 * Signs the page in the way production does: `/api/auth/session` names the
 * account, a second late as a real round trip can be, and the dev-only hook
 * stays unset. That hook also makes `getCurrentUser()` answer, which a real
 * session never does, so specs signed in with it passed while production
 * sent signed-in clicks down the guest path (founder report 2026-10-01:
 * "Could not find this pursuit." on every status change).
 *
 * Runs on any origin, prod included: only this browser's requests are
 * answered. A server action that refuses a browser with no session ("User
 * not authenticated") is handed to `answer` with its arguments; what it
 * returns becomes the action's result, and undefined keeps the refusal.
 */
export async function signInLikeProduction(page: Page, answer: (args: unknown[]) => unknown) {
  await page.route("**/api/auth/session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ json: { user: PRODUCTION_SIGN_IN_ACCOUNT }, headers: { "cache-control": "no-store" } });
  });
  await page.route(
    () => true,
    async (route) => {
      const req = route.request();
      // Not an action: let the session route above (or the network) answer it.
      if (req.method() !== "POST" || !req.headers()["next-action"]) return route.fallback();
      const res = await route.fetch();
      const text = await res.text();
      if (!text.includes("User not authenticated")) return route.fulfill({ response: res, body: text });
      let args: unknown[];
      try {
        args = JSON.parse(req.postData() ?? "[]");
      } catch {
        return route.fulfill({ response: res, body: text });
      }
      const value = Array.isArray(args) ? answer(args) : undefined;
      return route.fulfill({ response: res, body: value === undefined ? text : withActionResult(text, value) });
    },
  );
}

/** `encodeReply` sends an unset field as "$undefined"; drop those to read an action's object argument. */
export const actionObject = (arg: unknown) =>
  Object.fromEntries(Object.entries((arg ?? {}) as Record<string, unknown>).filter(([, v]) => v !== "$undefined"));
