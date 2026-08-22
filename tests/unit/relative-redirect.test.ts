import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeRedirect } from "../../src/lib/http/relative-redirect";

test("relativeRedirect returns a 307 with the exact relative Location", () => {
  const res = relativeRedirect("/jobs?followed=0");
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/jobs?followed=0");
});

test("relativeRedirect preserves an arbitrary safe app path and query", () => {
  const res = relativeRedirect("/co/acme?x=1");
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/co/acme?x=1");
});

test("relativeRedirect throws on a protocol-relative path", () => {
  assert.throws(() => relativeRedirect("//evil.com"));
});

test("relativeRedirect throws on an absolute URL", () => {
  assert.throws(() => relativeRedirect("https://evil.com/x"));
});

test("relativeRedirect accepts an explicit status override, e.g. 302 for a POST handler", () => {
  const res = relativeRedirect("/", 302);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});
