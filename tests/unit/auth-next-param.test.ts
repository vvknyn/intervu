import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthGatedProductPath, validateNextParam } from "../../src/lib/auth/product-routes";

test("isAuthGatedProductPath matches product prefixes", () => {
  assert.equal(isAuthGatedProductPath("/jobs"), false);
  assert.equal(isAuthGatedProductPath("/yours/abc"), true);
  assert.equal(isAuthGatedProductPath("/connect"), true);
  assert.equal(isAuthGatedProductPath("/"), false);
  assert.equal(isAuthGatedProductPath("/mock/auth-gate"), false);
});

test("isAuthGatedProductPath carves out the public /connect/help exception, without opening the rest of /connect", () => {
  // Note: pathname never includes a #fragment (fragments are client-only,
  // never sent to the server) — the anchors in the spec's contract
  // (#install-node etc.) live on this same public path, not as separate
  // paths to carve out.
  assert.equal(isAuthGatedProductPath("/connect/help"), false);
  assert.equal(isAuthGatedProductPath("/connect/help/anything"), false);
  assert.equal(isAuthGatedProductPath("/connect"), true);
  assert.equal(isAuthGatedProductPath("/connect/other"), true);
});

test("validateNextParam accepts safe in-app paths", () => {
  assert.equal(validateNextParam("/jobs"), "/jobs");
  assert.equal(validateNextParam("/jobs?q=design"), "/jobs?q=design");
  assert.equal(validateNextParam("/connect?client=claude"), "/connect?client=claude");
  assert.equal(validateNextParam("/"), "/");
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
