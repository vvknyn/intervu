import { test } from "node:test";
import assert from "node:assert/strict";
import { isApiShapedPath, isThirdPartyCallbackPath, shouldBlockSuspiciousRequest } from "../../src/lib/shield/suspicious-request";

test("isApiShapedPath: matches /api and any nested /api/... path", () => {
  assert.equal(isApiShapedPath("/api"), true);
  assert.equal(isApiShapedPath("/api/auth/session"), true);
  assert.equal(isApiShapedPath("/apitest"), false);
  assert.equal(isApiShapedPath("/jobs"), false);
});

test("shouldBlockSuspiciousRequest: blocks a non-GET /api/ request with no User-Agent at all", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/auth/session", method: "POST", userAgent: null }),
    true,
  );
});

test("shouldBlockSuspiciousRequest: blocks a non-GET /api/ request with a blank User-Agent", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/auth/session", method: "DELETE", userAgent: "   " }),
    true,
  );
});

test("shouldBlockSuspiciousRequest: never blocks a GET, regardless of path or User-Agent", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/auth/session", method: "GET", userAgent: null }),
    false,
  );
  assert.equal(shouldBlockSuspiciousRequest({ pathname: "/trends", method: "GET", userAgent: "curl/8.4.0" }), false);
});

test("shouldBlockSuspiciousRequest: never blocks a page route (not API-shaped), even with no User-Agent", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/trends", method: "POST", userAgent: null }),
    false,
  );
});

test("shouldBlockSuspiciousRequest: a real User-Agent on a non-GET /api/ request is never blocked", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({
      pathname: "/api/auth/session",
      method: "POST",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }),
    false,
  );
});

test("shouldBlockSuspiciousRequest: HEAD is treated the same as GET (never blocked)", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/auth/session", method: "HEAD", userAgent: undefined }),
    false,
  );
});

// --- Third-party callbacks (regression: Resend disabled our webhook endpoint,
// Aug 18 2026). Other companies' servers call INTO us; they authenticate with a
// signed body and choose their own User-Agent. Resend sends none, so the
// browser-shaped heuristic above 403'd every bounce and complaint before the
// route could verify the signature.

test("shouldBlockSuspiciousRequest: never blocks a signed third-party callback that sends no User-Agent", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/webhooks/resend", method: "POST", userAgent: null }),
    false,
  );
});

test("shouldBlockSuspiciousRequest: the callback carve-out is class-wide, not one vendor", () => {
  for (const provider of ["stripe", "github", "twilio"]) {
    assert.equal(
      shouldBlockSuspiciousRequest({ pathname: `/api/webhooks/${provider}`, method: "POST", userAgent: "" }),
      false,
      `/api/webhooks/${provider} must be exempt without being named anywhere`,
    );
  }
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/webhooks", method: "POST", userAgent: "   " }),
    false,
  );
});

test("shouldBlockSuspiciousRequest: the carve-out stops at the path segment boundary", () => {
  assert.equal(
    shouldBlockSuspiciousRequest({ pathname: "/api/webhooksomething", method: "POST", userAgent: null }),
    true,
    "a look-alike prefix must not inherit the exemption",
  );
});

test("isThirdPartyCallbackPath: only /api/webhooks and paths beneath it", () => {
  assert.equal(isThirdPartyCallbackPath("/api/webhooks"), true);
  assert.equal(isThirdPartyCallbackPath("/api/webhooks/resend"), true);
  assert.equal(isThirdPartyCallbackPath("/api/webhooksomething"), false);
  assert.equal(isThirdPartyCallbackPath("/api/auth/session"), false);
  assert.equal(isThirdPartyCallbackPath("/webhooks/resend"), false);
});
