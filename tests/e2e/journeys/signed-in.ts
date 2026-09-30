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

const isLocal = (baseURL: string | undefined) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL ?? "http://localhost:3000");

export const signedInTest = base.extend<{ signedIn: void }>({
  storageState: async ({}, use) => {
    await use(process.env.E2E_STORAGE_STATE || undefined);
  },
  signedIn: [
    async ({ page, baseURL }, use) => {
      if (!process.env.E2E_STORAGE_STATE) {
        base.skip(!isLocal(baseURL), SIGNED_IN_SKIP_REASON);
        await page.addInitScript(() => {
          (window as unknown as Record<string, unknown>).__INTERVU_E2E_AUTH__ = {
            uid: "e2e-packs", displayName: "Sam Rivera", email: "sam.rivera.dev@example.com", emailVerified: true, isAnonymous: false,
            providerData: [], metadata: {}, photoURL: null, phoneNumber: null, providerId: "password", tenantId: null, refreshToken: "x",
          };
        });
      }
      await use();
    },
    { auto: true },
  ],
});
