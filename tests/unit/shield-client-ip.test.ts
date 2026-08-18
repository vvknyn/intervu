import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClientIp, resolveClientIpFromHeaders } from "../../src/lib/shield/client-ip";

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

test("resolveClientIp: CF-Connecting-IP wins over X-Forwarded-For when both are present", () => {
  assert.equal(resolveClientIp("203.0.113.5, 10.0.0.1", "198.51.100.9"), "198.51.100.9");
});

test("resolveClientIp: trims whitespace around CF-Connecting-IP", () => {
  assert.equal(resolveClientIp(null, "  198.51.100.9  "), "198.51.100.9");
});

test("resolveClientIp: falls back to XFF leftmost when CF-Connecting-IP is absent (Cloudflare not in front)", () => {
  assert.equal(resolveClientIp("203.0.113.5, 10.0.0.1", undefined), "203.0.113.5");
  assert.equal(resolveClientIp("203.0.113.5, 10.0.0.1", null), "203.0.113.5");
});

test("resolveClientIp: falls back to XFF when CF-Connecting-IP is an empty/whitespace-only header", () => {
  assert.equal(resolveClientIp("203.0.113.5", ""), "203.0.113.5");
  assert.equal(resolveClientIp("203.0.113.5", "   "), "203.0.113.5");
});

test("resolveClientIp: 'unknown' when neither header is present", () => {
  assert.equal(resolveClientIp(null, null), "unknown");
});

test("resolveClientIpFromHeaders: reads CF-Connecting-IP off a real Headers object", () => {
  const h = new Headers({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.2.3.4" });
  assert.equal(resolveClientIpFromHeaders(h), "198.51.100.9");
});

test("resolveClientIpFromHeaders: falls back to XFF leftmost when Headers has no CF-Connecting-IP", () => {
  const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
  assert.equal(resolveClientIpFromHeaders(h), "203.0.113.5");
});

test("resolveClientIpFromHeaders: 'unknown' when a Headers object has neither header", () => {
  assert.equal(resolveClientIpFromHeaders(new Headers()), "unknown");
});
