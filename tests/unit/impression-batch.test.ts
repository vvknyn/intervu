import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_IMPRESSION_BATCH,
  recordImpression,
  flushImpressions,
} from "../../src/lib/jobs/impression-batch";

/**
 * Pure decision half of `useResultImpressions` (results_impressed, see
 * events.ts) — no DOM, no timers, so the batching/dedupe rules are provable
 * without an IntersectionObserver mock.
 */

test("recordImpression adds a newly-visible job to the pending batch", () => {
  const state = recordImpression(EMPTY_IMPRESSION_BATCH, "job-1");
  assert.deepEqual([...state.pending], ["job-1"]);
  assert.equal(state.reported.size, 0);
});

test("recordImpression is idempotent for a job already pending", () => {
  const once = recordImpression(EMPTY_IMPRESSION_BATCH, "job-1");
  const twice = recordImpression(once, "job-1");
  assert.deepEqual([...twice.pending], ["job-1"]);
  assert.equal(twice, once, "re-entering an already-pending job should be a no-op, not a new object");
});

test("flushImpressions drains the whole pending batch in one call", () => {
  let state = EMPTY_IMPRESSION_BATCH;
  state = recordImpression(state, "job-1");
  state = recordImpression(state, "job-2");
  state = recordImpression(state, "job-3");

  const { jobIds, next } = flushImpressions(state);
  assert.deepEqual(jobIds.sort(), ["job-1", "job-2", "job-3"]);
  assert.equal(next.pending.size, 0, "flush must clear pending, not partially drain it");
});

test("flushImpressions on an empty batch reports nothing", () => {
  const { jobIds, next } = flushImpressions(EMPTY_IMPRESSION_BATCH);
  assert.deepEqual(jobIds, []);
  assert.equal(next, EMPTY_IMPRESSION_BATCH, "a no-op flush should return the same state, not a new empty one");
});

// The dedupe guarantee: once a job has been through a flush (reported),
// scrolling back over it later in the SAME mount must never re-queue it —
// otherwise a visitor scrolling up and down would inflate one real
// impression into many.
test("a flushed job is never re-added to pending later in the same mount", () => {
  const afterFirstFlush = flushImpressions(recordImpression(EMPTY_IMPRESSION_BATCH, "job-1")).next;
  assert.ok(afterFirstFlush.reported.has("job-1"));

  const sawItAgain = recordImpression(afterFirstFlush, "job-1");
  assert.equal(sawItAgain, afterFirstFlush, "re-recording a reported job must be a no-op");
  assert.equal(sawItAgain.pending.size, 0);

  const secondFlush = flushImpressions(sawItAgain);
  assert.deepEqual(secondFlush.jobIds, [], "a job already reported must never be flushed twice");
});

test("batch-flush covers a burst of several rows becoming visible before one flush", () => {
  let state = EMPTY_IMPRESSION_BATCH;
  for (const id of ["job-1", "job-2", "job-3", "job-4"]) {
    state = recordImpression(state, id);
  }
  const { jobIds } = flushImpressions(state);
  assert.equal(jobIds.length, 4, "one flush should report the whole burst as a single batch");
});
