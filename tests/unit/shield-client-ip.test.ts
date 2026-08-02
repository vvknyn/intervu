import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientIp } from "../../src/lib/shield/client-ip";

test("resolveClientIp: a single-value header (Caddy's own determination) is used as-is", () => {
  assert.equal(resolveClientIp("203.0.113.5"), "203.0.113.5");
});

test("resolveClientIp: takes the leftmost entry of a comma-separated chain", () => {
  assert.equal(resolveClientIp("203.0.113.5, 10.0.0.1, 10.0.0.2"), "203.0.113.5");
});

test("resolveClientIp: trims whitespace around the leftmost entry", () => {
  assert.equal(resolveClientIp("  203.0.113.5  ,10.0.0.1"), "203.0.113.5");
});

test("resolveClientIp: missing header falls back to a shared 'unknown' bucket", () => {
  assert.equal(resolveClientIp(null), "unknown");
  assert.equal(resolveClientIp(undefined), "unknown");
});

test("resolveClientIp: empty-string header also falls back to 'unknown'", () => {
  assert.equal(resolveClientIp(""), "unknown");
});
