import { test as base, expect } from '@playwright/test';

/**
 * Shared chokepoint for specs that need a real signed-in WorkOS session.
 *
 * `/settings` (see AUTH_GATED_PRODUCT_PREFIXES in src/lib/auth/product-routes.ts)
 * is server-gated: middleware bounces a logged-out visitor off the page
 * (to the WorkOS AuthKit hosted login, or an internal /login fallback)
 * before any test assertion on that page can run.
 *
 * We never fabricate a session — no stubbed cookies, no synthetic storage
 * state. The only honest way to exercise a gated spec is against a REAL
 * signed-in session, supplied out-of-band via E2E_STORAGE_STATE.
 *
 * - E2E_STORAGE_STATE unset: every test that imports `test` from this file
 *   skips with a clear, consistent reason instead of failing on the bounce.
 * - E2E_STORAGE_STATE set (path to a Playwright storageState JSON captured
 *   from a real sign-in): the path is wired straight into browser-context
 *   creation, so the spec runs against that real session.
 *
 * New auth-gated spec/test => import { test, expect } from this file. Do not
 * copy the env check or skip reason into another spec file.
 */
export const AUTH_GATE_SKIP_REASON =
  'auth-gated: set E2E_STORAGE_STATE to a signed-in storageState file to run';

export const test = base.extend({
  storageState: async ({}, use) => {
    const storageStatePath = process.env.E2E_STORAGE_STATE;
    test.skip(!storageStatePath, AUTH_GATE_SKIP_REASON);
    await use(storageStatePath);
  },
});

export { expect };
