import { test } from "node:test";
import assert from "node:assert/strict";
import {
    activeFilterEntries,
    toggleFacetValue,
    PRISTINE_FILTER_STATE,
    type FilterState,
} from "../../src/components/jobs/FilterPanel";

// Review fix (2026-07-19): was a locally-duplicated literal — now the same
// exported constant page.tsx's `clearAll`/`pendingClearAll` consume, so this
// test would fail if either of THOSE ever drifted from it, not just prove
// the literal is internally consistent with itself.
const base: FilterState = PRISTINE_FILTER_STATE;

test("pristine state has no active entries (hideGhosts default is not 'active')", () => {
    assert.equal(activeFilterEntries(base).length, 0);
});

test("each active filter yields one clearable entry", () => {
    // Explicit `FilterState` annotation (not in the original brief snippet) —
    // without it, `reduce`'s initial-value inference locks onto this object
    // literal's narrower shape (`facets.work_type: string[]`, not `string[] |
    // undefined`), which `tsc --noEmit` rejects against `clear`'s `FilterState`
    // param/return even though the untyped version runs fine under `tsx`.
    const s: FilterState = { ...base, facets: { work_type: ["remote"] }, salaryMin: 150_000, postedBucket: "7d" };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 3);
    const cleared = entries.reduce((acc, e) => e.clear(acc), s);
    assert.deepEqual(cleared, base);
});

// Task 10: shared by the desktop rail's `toggleFacet` (page.tsx) and the
// mobile sheet's pending-state mutator, so both surfaces mutate a facet's
// selected-value list identically instead of each carrying its own copy.
test("toggleFacetValue adds a value not yet selected", () => {
    const next = toggleFacetValue({}, "work_type", "remote");
    assert.deepEqual(next, { work_type: ["remote"] });
});

test("toggleFacetValue removes an already-selected value", () => {
    const next = toggleFacetValue({ work_type: ["remote", "onsite"] }, "work_type", "remote");
    assert.deepEqual(next, { work_type: ["onsite"] });
});

test("toggleFacetValue drops the key entirely once its last value is removed", () => {
    const next = toggleFacetValue({ work_type: ["remote"] }, "work_type", "remote");
    assert.deepEqual(next, {});
});

test("toggleFacetValue leaves other facet keys untouched", () => {
    const next = toggleFacetValue({ source: ["greenhouse"] }, "work_type", "remote");
    assert.deepEqual(next, { source: ["greenhouse"], work_type: ["remote"] });
});
