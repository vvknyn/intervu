import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_IMPRESSION_BATCH,
  recordImpression,
  flushImpressions,
} from "../../src/lib/jobs/impression-batch";

/**
 * Pure decision half of `useResultImpressions` (results_impressed, see
 * events.ts) — no DOM, no timers, so the batching/dedupe/position rules are
 * provable without an IntersectionObserver mock.
 */

test("recordImpression adds a newly-visible job to the pending batch", () => {
  const state = recordImpression(EMPTY_IMPRESSION_BATCH, "q1", "job-1", 1);
  assert.deepEqual([...state.pending.keys()], ["q1:job-1"]);
  assert.equal(state.reported.size, 0);
});

test("recordImpression is idempotent for a job already pending", () => {
  const once = recordImpression(EMPTY_IMPRESSION_BATCH, "q1", "job-1", 1);
  const twice = recordImpression(once, "q1", "job-1", 1);
  assert.deepEqual([...twice.pending.keys()], ["q1:job-1"]);
  assert.equal(twice, once, "re-entering an already-pending job should be a no-op, not a new object");
});

test("flushImpressions drains the whole pending batch in one call", () => {
  let state = EMPTY_IMPRESSION_BATCH;
  state = recordImpression(state, "q1", "job-1", 1);
  state = recordImpression(state, "q1", "job-2", 2);
  state = recordImpression(state, "q1", "job-3", 3);

  const { impressions, next } = flushImpressions(state);
  assert.deepEqual(
    impressions.map((i) => i.jobId).sort(),
    ["job-1", "job-2", "job-3"],
  );
  assert.equal(next.pending.size, 0, "flush must clear pending, not partially drain it");
});

test("flushImpressions on an empty batch captures nothing", () => {
  const { impressions, next } = flushImpressions(EMPTY_IMPRESSION_BATCH);
  assert.deepEqual(impressions, []);
  assert.equal(next, EMPTY_IMPRESSION_BATCH, "a no-op flush should return the same state, not a new empty one");
});

test("position survives a flush", () => {
  const state = recordImpression(EMPTY_IMPRESSION_BATCH, "q1", "job-1", 7);
  const { impressions } = flushImpressions(state);
  assert.deepEqual(impressions, [{ jobId: "job-1", position: 7 }]);
});

// The dedupe guarantee: once a job has been through a flush (reported) for a
// given queryId, scrolling back over it later under the SAME query must
// never re-queue it — otherwise a visitor scrolling up and down would
// inflate one real impression into many.
test("a flushed job is never re-added to pending later under the SAME queryId", () => {
  const afterFirstFlush = flushImpressions(recordImpression(EMPTY_IMPRESSION_BATCH, "q1", "job-1", 1)).next;
  assert.ok(afterFirstFlush.reported.has("q1:job-1"));

  const sawItAgain = recordImpression(afterFirstFlush, "q1", "job-1", 1);
  assert.equal(sawItAgain, afterFirstFlush, "re-recording a reported job for the same query must be a no-op");
  assert.equal(sawItAgain.pending.size, 0);

  const secondFlush = flushImpressions(sawItAgain);
  assert.deepEqual(secondFlush.impressions, [], "a job already reported for this query must never be flushed twice");
});

// The class case this fix exists for: a job re-shown under a NEW queryId
// (a refined search) is a different dedupe key and IS eligible again —
// without this, a job present in every refinement would only ever be
// impressed once per mount, permanently undercounting the denominator.
test("the same job under a NEW queryId IS re-impressed", () => {
  const afterFirstFlush = flushImpressions(recordImpression(EMPTY_IMPRESSION_BATCH, "q1", "job-1", 1)).next;
  assert.ok(afterFirstFlush.reported.has("q1:job-1"));

  const underNewQuery = recordImpression(afterFirstFlush, "q2", "job-1", 1);
  assert.notEqual(underNewQuery, afterFirstFlush, "a new queryId must not be treated as a no-op");
  assert.ok(underNewQuery.pending.has("q2:job-1"));

  const { impressions } = flushImpressions(underNewQuery);
  assert.deepEqual(impressions, [{ jobId: "job-1", position: 1 }]);
});

test("batch-flush covers a burst of several rows becoming visible before one flush", () => {
  let state = EMPTY_IMPRESSION_BATCH;
  ["job-1", "job-2", "job-3", "job-4"].forEach((id, i) => {
    state = recordImpression(state, "q1", id, i + 1);
  });
  const { impressions } = flushImpressions(state);
  assert.equal(impressions.length, 4, "one flush should report the whole burst as a single batch");
});
