import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSuppressOpenCount } from "../../src/lib/companies/open-count";

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
