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
  assert.equal(isAgeSignal({ text: "posted within the last 7 days", status: "favorable", kind: "freshness" }), true);
  assert.equal(isAgeSignal({ text: "first seen by us 3 months ago", status: "unfavorable", kind: "freshness" }), true);
  assert.equal(isAgeSignal({ text: "salary not disclosed (common for some regions)", status: "unknown", kind: "pay" }), false);
});

test("age-signal-only class: age is the SOLE negative signal — the note mounts", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", status: "unfavorable", kind: "freshness" },
    { text: "no repost history on this role", status: "favorable", kind: "reposts" },
    { text: "description has real substance", status: "favorable", kind: "description" },
    { text: "salary disclosed — $120k-$180k", status: "favorable", kind: "pay" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), true);
});

test("multi-signal class: age negative PLUS another real negative signal — the note does NOT mount, the existing verdict stands unsoftened", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", status: "unfavorable", kind: "freshness" },
    { text: "relisted from an earlier posting", status: "unfavorable", kind: "reposts" },
    { text: "description is thin", status: "unfavorable", kind: "description" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("no negative signals at all: nothing to balance, the note does not mount", () => {
  const signals: GhostSignal[] = [
    { text: "posted within the last 7 days", status: "favorable", kind: "freshness" },
    { text: "no repost history on this role", status: "favorable", kind: "reposts" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("the sole negative signal is NOT age (e.g. thin description alone) — the note must not mount, since it's specifically an age-balance note", () => {
  const signals: GhostSignal[] = [
    { text: "posted within the last 7 days", status: "favorable", kind: "freshness" },
    { text: "description is thin", status: "unfavorable", kind: "description" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), false);
});

test("empty signal list: no crash, note does not mount", () => {
  assert.equal(shouldShowAgeBalanceNote([]), false);
});

// ITEM T (2026-08-15) / status rework (2026-08-16): deriveGhostSignals'
// reposts line can never come back favorable (no close/reopen data source
// exists — see its doc comment), so every job with a first-seen date carries
// one. It is now `unknown` rather than a negative, so it drops out of the
// negatives count by CONSTRUCTION — this used to need a hand-written
// `kind !== "reposts"` exception here, which the ghost-check counter never
// received and which is why an ordinary posting read "1/4 favorable". The
// test pins the class (an unmeasured signal is not a failed one), not the
// one call site that surfaced it.
test("an unmeasured signal does not count toward 'age is the sole negative' — the note still mounts", () => {
  const signals: GhostSignal[] = [
    { text: "first seen by us 3 months ago", status: "unfavorable", kind: "freshness" },
    { text: "repost (close/reopen) history not tracked yet", status: "unknown", kind: "reposts" },
    { text: "description has real substance", status: "favorable", kind: "description" },
    { text: "salary disclosed — $120k-$180k", status: "favorable", kind: "pay" },
  ];
  assert.equal(shouldShowAgeBalanceNote(signals), true);
});
