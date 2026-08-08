import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveVisitBannerState } from "../../src/lib/jobs/visit-banner";

test("class case: no stored cursor never shows, no matter how big the count", () => {
    // A first-time visitor must never see "since your last visit" — the
    // count alone (even a large one) can't override the honesty gate.
    assert.equal(resolveVisitBannerState({ hasCursor: false, count: 50 }), "hidden");
});

test("a stored cursor with zero new postings hides", () => {
    assert.equal(resolveVisitBannerState({ hasCursor: true, count: 0 }), "hidden");
});

test("a stored cursor with at least one new posting shows", () => {
    assert.equal(resolveVisitBannerState({ hasCursor: true, count: 1 }), "shown");
});

test("a stored cursor with many new postings shows", () => {
    assert.equal(resolveVisitBannerState({ hasCursor: true, count: 42 }), "shown");
});
