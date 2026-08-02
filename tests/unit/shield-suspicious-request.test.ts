import { test } from "node:test";
import assert from "node:assert/strict";
import { isApiShapedPath, shouldBlockSuspiciousRequest } from "../../src/lib/shield/suspicious-request";

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
