/**
 * Round 2 (Sep 10 2026) defect: `/api/jobs/count`'s strict-mechanism branch
 * set `total = titled` unconditionally, but `/jobs` itself relaxes to the
 * whole-document pass when the strict pass returns zero hits
 * (`shouldRelaxSearch`, meilisearch.ts) — so a strict-mechanism, zero-hit
 * query had this canary and the page it's checking disagree on `total`.
 *
 * `resolveCountRouteTotal` is the route's decision pulled out into a pure,
 * directly-testable function (no HTTP mocking needed) so this reuse of the
 * SAME exported `shouldRelaxSearch` predicate the SERP uses is pinned
 * without re-stating the relax rule.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCountRouteTotal } from "../../src/app/api/jobs/count/route";

test("strict mechanism, titled=0 (zero-hit), non-empty q → relaxes to wholeDoc", () => {
  assert.equal(resolveCountRouteTotal("strict", 0, 37, "software engineer"), 37);
});

test("strict mechanism, titled=12 (non-zero) → no relax, reports titled", () => {
  assert.equal(resolveCountRouteTotal("strict", 12, 37, "software engineer"), 12);
});

test("strict mechanism, titled=0 but empty q → shouldRelaxSearch requires a real query, reports titled", () => {
  assert.equal(resolveCountRouteTotal("strict", 0, 37, ""), 0);
});

test("tiered mechanism is unchanged — routes through resolveHeadlineTotal (union default)", () => {
  assert.equal(resolveCountRouteTotal("tiered", 589, 2231, "software engineer"), 2231);
});
