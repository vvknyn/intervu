import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpenCount, shouldSuppressOpenCount } from "../../src/lib/companies/open-count";
import type { JobSearchResult } from "../../src/lib/jobs/types";

type Result = Pick<JobSearchResult, "total" | "facetDistribution" | "note" | "preview">;
function result(overrides: Partial<Result> & Pick<Result, "total">): Result {
  return { facetDistribution: undefined, note: undefined, preview: undefined, ...overrides };
}

/**
 * JobDetail's "Company hiring-truth mini-KPI rail" (2026-08-20 fix) used to
 * fall back to `job.company_open_count` — a stale, ingest-time aggregate —
 * whenever the live count wasn't available yet, which for guests was
 * ALWAYS (see `jobs.ts`'s `getCompanyOpenCountAction`). A live, honestly
 * resolved count of 0 for a company that IS currently hiring for the very
 * job the reader is looking at is still a real self-contradiction — the
 * page itself proves the company has at least one open role. This function
 * is the one place that decides whether the "Live roles" stat should
 * render at all, independent of where the number came from.
 */
test("count 0 + job not closed suppresses the stat — the self-contradiction case", () => {
  assert.equal(shouldSuppressOpenCount(0, false), true);
});

test("count 0 + job closed does NOT suppress — an honest zero for a closed posting isn't contradictory", () => {
  // The posting itself already agrees it's no longer live, so "0 live
  // roles" for its company is a consistent fact, not a lie.
  assert.equal(shouldSuppressOpenCount(0, true), false);
});

test("a nonzero count never suppresses, regardless of job status", () => {
  assert.equal(shouldSuppressOpenCount(1, false), false);
  assert.equal(shouldSuppressOpenCount(1, true), false);
  assert.equal(shouldSuppressOpenCount(500, false), false);
});

/**
 * `resolveOpenCount`'s two branches — the fix for the class of bug behind
 * Stewart's `/co` page stating "66 open roles" over a rendered list that
 * deduped to 62: the old code always took `Math.max(raw Meili total, hit
 * count)`, which can only ever pick the inflated `total` (it counts rows the
 * caller already dropped — internal postings, re-synced duplicates) whenever
 * the fetch actually covered every matching hit.
 */

test("fetch complete (total <= limit): count is the caller's own hitCount, exact — not Math.max against the inflated raw total", () => {
  // Mirrors the Stewart shape: raw total (66) counts rows the caller already
  // filtered/deduped out of its final array (62).
  const r = result({ total: 66 });
  assert.deepEqual(resolveOpenCount(r, 62, 200), { value: 62, isLowerBound: false });
});

test("fetch complete, a DIFFERENT shape than the bug that surfaced it: hitCount equals total (no filtering/dedup dropped anything)", () => {
  const r = result({ total: 12 });
  assert.deepEqual(resolveOpenCount(r, 12, 200), { value: 12, isLowerBound: false });
});

test("fetch complete, note set but no preview: exact — a bare note doesn't override completeness, only `preview` does", () => {
  const r = result({ total: 5, note: "Company domain filter applied locally" });
  assert.deepEqual(resolveOpenCount(r, 5, 200), { value: 5, isLowerBound: false });
});

test("fetch complete BUT preview: still a lower bound — a preview backend's completeness is relative to its own capped slice, not the real corpus", () => {
  const r = result({ total: 5, preview: true, note: "Snapshot preview (dev)" });
  assert.deepEqual(resolveOpenCount(r, 5, 200), { value: 5, isLowerBound: true });
});

test("total lands EXACTLY on the limit: NOT treated as complete — indistinguishable from a saturated post-filter early-stop", () => {
  // Same shape as `total > limit` for this decision: only `total < limit`
  // proves nothing was left unfetched.
  const r = result({ total: 200, note: "Company domain filter applied locally (count is a lower bound)" });
  assert.deepEqual(resolveOpenCount(r, 200, 200), { value: 200, isLowerBound: true });
});

test("fetch incomplete (total > limit): unchanged from before — falls back to the backend total via Math.max, no note ⇒ not marked a lower bound", () => {
  const r = result({ total: 250 });
  assert.deepEqual(resolveOpenCount(r, 200, 200), { value: 250, isLowerBound: false });
});

test("fetch incomplete + preview: always a lower bound", () => {
  const r = result({ total: 250, preview: true });
  assert.deepEqual(resolveOpenCount(r, 200, 200), { value: 250, isLowerBound: true });
});

test("fetch incomplete + saturated hit window + a qualifying note: marked a lower bound (post-filter early-stop case)", () => {
  const r = result({ total: 250, note: "partial domain scan" });
  assert.deepEqual(resolveOpenCount(r, 200, 200), { value: 250, isLowerBound: true });
});

test("fetch incomplete: never claims fewer roles than the hit window itself returned", () => {
  // Pathological post-filter over-scan: hitCount exceeds the window's own total.
  const r = result({ total: 250, note: "partial domain scan" });
  assert.deepEqual(resolveOpenCount(r, 260, 200), { value: 260, isLowerBound: true });
});
