import { test } from "node:test";
import assert from "node:assert/strict";
import { POSTING_AGE_CONTEXT_COPY, isAgeSignal, shouldShowAgeBalanceNote } from "../../src/lib/jobs/ghost-context-copy";
import type { GhostSignal } from "../../src/components/jobs/job-detail-facts";

/** R7 (founder, 2026-08-09): posting age alone must never read as a ghost
 *  verdict. Two classes under test — age-signal-only (mount) vs
 *  multi-signal (don't mount, don't soften a real verdict). */

test("copy string: exported from one module, plain-language, never claims a job is definitely still open (boundary: facts only)", () => {
  assert.equal(typeof POSTING_AGE_CONTEXT_COPY, "string");
  assert.ok(POSTING_AGE_CONTEXT_COPY.length > 0);
  assert.ok(!/probably still open/i.test(POSTING_AGE_CONTEXT_COPY), "must never assert a specific job is likely still open");
  assert.ok(/months to fill|rolling basis/i.test(POSTING_AGE_CONTEXT_COPY), "must give a real reason age alone is inconclusive");
});

test("isAgeSignal: recognizes both branches deriveGhostSignals emits for the freshness/first-seen line", () => {
  assert.equal(isAgeSignal({ text: "freshness — posted within the last 7 days", positive: true, kind: "freshness" }), true);
  assert.equal(isAgeSignal({ text: "first seen by us 3 months ago", positive: false, kind: "freshness" }), true);
  assert.equal(isAgeSignal({ text: "salary not disclosed (common for some regions)", positive: false, kind: "pay" }), false);
});

test("age-signal-only class: age is the SOLE negative signal — the note mounts", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", positive: false, kind: "freshness" },
    { text: "no repost history on this role", positive: true, kind: "reposts" },
    { text: "description has real substance", positive: true, kind: "description" },
    { text: "salary disclosed — $120k-$180k", positive: true, kind: "pay" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), true);
});

test("multi-signal class: age negative PLUS another real negative signal — the note does NOT mount, the existing verdict stands unsoftened", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", positive: false, kind: "freshness" },
    { text: "relisted from an earlier posting", positive: false, kind: "reposts" },
    { text: "description is thin", positive: false, kind: "description" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("no negative signals at all: nothing to balance, the note does not mount", () => {
  const signals: GhostSignal[] = [
    { text: "freshness — posted within the last 7 days", positive: true, kind: "freshness" },
    { text: "no repost history on this role", positive: true, kind: "reposts" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("the sole negative signal is NOT age (e.g. thin description alone) — the note must not mount, since it's specifically an age-balance note", () => {
  const signals: GhostSignal[] = [
    { text: "freshness — posted within the last 7 days", positive: true, kind: "freshness" },
    { text: "description is thin", positive: false, kind: "description" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("empty signal list: no crash, note does not mount", () => {
  assert.equal(shouldShowAgeBalanceNote([]), false);
});

// ITEM T (2026-08-15): deriveGhostSignals' reposts line is now ALWAYS
// `positive: false` (no repost/close-reopen data source exists — see its
// doc comment), so every job with a first-seen date carries at least one
// non-favorable reposts row. Without excluding "reposts" from the negatives
// count, this note would never mount again for ANY job. This pins the class
// fix, not just the one call site that surfaced it.
test("ITEM T: an always-negative reposts row (the new deriveGhostSignals reality) does not count toward 'age is the sole negative' — the note still mounts", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", positive: false, kind: "freshness" },
    { text: "repost (close/reopen) history not tracked yet", positive: false, kind: "reposts" },
    { text: "description has real substance", positive: true, kind: "description" },
    { text: "salary disclosed — $120k-$180k", positive: true, kind: "pay" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), true);
});
