import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig, { ENFORCED_IMAGE_POLICY } from "../../next.config";

// The remote-image class is closed at the browser: an ENFORCED img-src that
// names no remote host. Read from the headers Next really serves, for every path.
test("every route is served an enforced img-src with no remote host", async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all, "a catch-all header rule exists");
  const enforced = all.headers.filter((h) => h.key === "Content-Security-Policy");
  assert.deepEqual(enforced.map((h) => h.value), [ENFORCED_IMAGE_POLICY]);
  assert.equal(ENFORCED_IMAGE_POLICY, "img-src 'self' data: blob:");
  assert.doesNotMatch(ENFORCED_IMAGE_POLICY, /https?:|\*/);
});

test("the enforced policy is images only: it cannot break scripts, styles or connections", () => {
  assert.deepEqual(ENFORCED_IMAGE_POLICY.split(";").map((d) => d.trim().split(/\s+/)[0]), ["img-src"]);
});
