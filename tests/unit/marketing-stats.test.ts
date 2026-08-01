import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingClaim, CORPUS_SOURCE_DESCRIPTOR } from "../../src/lib/marketing-stats";

/* ----------------------------- marketingClaim ----------------------------- */

test("marketingClaim degrades to copy without a number when stats are null", () => {
    const claim = marketingClaim(null);
    assert.match(claim, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
    assert.doesNotMatch(claim, /\d/, "no digit should appear when the corpus count is unknown");
});

test("marketingClaim renders an exact live-jobs count", () => {
    const claim = marketingClaim({ liveJobs: { kind: "exact", value: 12345 } });
    assert.match(claim, /12,345 live roles/);
    assert.match(claim, new RegExp(CORPUS_SOURCE_DESCRIPTOR));
});

test("marketingClaim renders a floor count with the honest '+' suffix", () => {
    const claim = marketingClaim({ liveJobs: { kind: "floor", value: 100_000 } });
    assert.match(claim, /100,000\+ live roles/);
});

test("marketingClaim never fabricates a count for a zero-value exact stat", () => {
    // Zero is a real, reportable count — distinct from `null` (unknown). The
    // claim should still render the number, not silently fall back to the
    // numberless copy.
    const claim = marketingClaim({ liveJobs: { kind: "exact", value: 0 } });
    assert.match(claim, /^0 live roles/);
});
