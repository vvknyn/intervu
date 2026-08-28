import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldHideSiteChrome } from "../../src/components/layout/should-hide-site-chrome";

test("/oauth joins /login, /auth, /mock as a chrome-free surface", () => {
  // The consent screen (2026-08-27 polish) — same reasoning as /login: a
  // full-bleed card should not sit under the product TopBar/Footer/MobileTabBar.
  assert.equal(shouldHideSiteChrome("/oauth/authorize"), true);
  assert.equal(shouldHideSiteChrome("/oauth"), true);
});

test("existing chrome-free routes are unaffected by the /oauth addition", () => {
  assert.equal(shouldHideSiteChrome("/login"), true);
  assert.equal(shouldHideSiteChrome("/auth/callback"), true);
  assert.equal(shouldHideSiteChrome("/mock/completeness"), true);
});

test("an ordinary product route keeps its chrome — the probe can say no", () => {
  assert.equal(shouldHideSiteChrome("/jobs"), false);
  assert.equal(shouldHideSiteChrome("/co/acme--com"), false);
});
