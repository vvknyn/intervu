import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthGatedProductPath, loginRedirectUrl, validateNextParam } from "../../src/lib/auth/product-routes";

test("isAuthGatedProductPath matches product prefixes", () => {
  assert.equal(isAuthGatedProductPath("/jobs"), false);
  // 2026-08-08 engagement wave: /yours and /connect are guest-reachable —
  // the guest tracker and /connect onboarding/waitlist ship real logged-out
  // experiences; only server-side account-data surfaces stay gated.
  assert.equal(isAuthGatedProductPath("/yours/abc"), false);
  assert.equal(isAuthGatedProductPath("/connect"), false);
  assert.equal(isAuthGatedProductPath("/connect/help"), false);
  assert.equal(isAuthGatedProductPath("/settings"), true);
  // Redesign (2026-08-27, frozen proposal #9): /account is now a one-line
  // redirect to /settings?tab=account with no gate of its own — "one door,
  // one guard" — so it drops out of the gated-prefix matcher entirely.
  assert.equal(isAuthGatedProductPath("/account/anything"), false);
  assert.equal(isAuthGatedProductPath("/"), false);
  assert.equal(isAuthGatedProductPath("/mock/auth-gate"), false);
});

test("validateNextParam accepts safe in-app paths", () => {
  assert.equal(validateNextParam("/jobs"), "/jobs");
  assert.equal(validateNextParam("/jobs?q=design"), "/jobs?q=design");
  assert.equal(validateNextParam("/jobs?resume=gate"), "/jobs?resume=gate");
  assert.equal(validateNextParam("/connect?client=claude"), "/connect?client=claude");
  assert.equal(validateNextParam("/admin"), "/admin");
  assert.equal(validateNextParam("/"), "/");
});

test("validateNextParam accepts canonical company page paths", () => {
  assert.equal(validateNextParam("/co/anthropic--com"), "/co/anthropic--com");
  assert.equal(validateNextParam("/co/anthropic--com?x=1"), "/co/anthropic--com?x=1");
});

test("isAuthGatedProductPath keeps /co public", () => {
  assert.equal(isAuthGatedProductPath("/co/anthropic--com"), false);
});

test("validateNextParam accepts the OAuth authorize return path with its query intact", () => {
  const authorizeReturn = "/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_challenge=xyz&code_challenge_method=S256&response_type=code";
  assert.equal(validateNextParam(authorizeReturn), authorizeReturn);
});

test("validateNextParam rejects protocol-relative and off-product paths", () => {
  assert.equal(validateNextParam("//evil.test/jobs"), null);
  assert.equal(validateNextParam("https://evil.test/jobs"), null);
  assert.equal(validateNextParam("/mock/completeness"), null);
  assert.equal(validateNextParam(""), null);
  assert.equal(validateNextParam(null), null);
});

test("validateNextParam rejects a protocol-relative path masquerading as the authorize return", () => {
  assert.equal(validateNextParam("//evil.test/oauth/authorize?client_id=abc"), null);
});

// middleware.ts hands a gated, logged-out request straight to
// loginRedirectUrl(request.nextUrl, pathname) — these assert what the
// caller in middleware.ts relies on: the result is always same-origin
// /login carrying the full original path + query as `next`, and can never
// be the WorkOS hosted chooser (skillful-spoon-89.authkit.app).
test("loginRedirectUrl bounces a bare gated path to /login with next=<path>", () => {
  const result = loginRedirectUrl(new URL("https://intervu.cc/settings"), "/settings");
  assert.equal(result.origin, "https://intervu.cc");
  assert.equal(result.pathname, "/login");
  assert.equal(result.searchParams.get("next"), "/settings");
  assert.ok(!result.toString().includes("authkit.app"));
});

test("loginRedirectUrl bounces a nested gated path + query string to /login with next=<full path+query>", () => {
  const result = loginRedirectUrl(
    new URL("https://intervu.cc/settings/security?tab=sessions&foo=bar"),
    "/settings/security",
  );
  assert.equal(result.origin, "https://intervu.cc");
  assert.equal(result.pathname, "/login");
  assert.equal(result.searchParams.get("next"), "/settings/security?tab=sessions&foo=bar");
  assert.equal(result.searchParams.size, 1);
  assert.ok(!result.toString().includes("authkit.app"));
});
