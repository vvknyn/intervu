import { test } from "node:test";
import assert from "node:assert/strict";
import {
    activeFilterEntries,
    chipLabelForEntry,
    entriesNeedingOwnChip,
    toggleFacetValue,
    PRISTINE_FILTER_STATE,
    STATIC_FACET_LADDERS,
    type FilterState,
} from "../../src/components/jobs/FilterPanel";
import { EXPERIENCE_LEVELS, EMPLOYMENT_TYPES, WORK_TYPES } from "../../src/lib/agent/facets";
import { BOARD_META } from "../../src/lib/boards/types";
import { DEFAULT_URL_STATE, serializeJobsUrl, parseJobsUrl, type JobsUrlState } from "../../src/lib/jobs/url-state";

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

// Task 11 (zero-result state) — `activeFilterEntries`'s `includeQuietDefaults`
// opt lets the zero-result caller (page.tsx's `emptyStateEntries`) name a
// silently-applied default (today, only the pristine "30d" posted-bucket)
// that the toolbar pill row deliberately keeps quiet. Same function, same
// `clear` semantics — no second "what's active" derivation.

test("yearsExperience is an active entry, labelled from the bucket, and its clear drops it back to pristine (undefined)", () => {
    const s: FilterState = { ...base, yearsExperience: "6-10" };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "yearsExperience");
    assert.deepEqual(entries[0].clear(s), base);
});

test("toolbar consumer (no opts) still omits the pristine 30d default even when another filter is active — regression guard on the fence", () => {
    const s: FilterState = { ...base, salaryMin: 100_000, postedBucket: "30d" };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "salaryMin");
});

test("zero-result state names the pristine 30d bucket as the SOLE excluder — no query, no other filters", () => {
    const entries = activeFilterEntries(base, { includeQuietDefaults: true });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "postedBucket");
    assert.equal(entries[0].label, "Last 30 days");
});

test("zero-result state still excludes explicit 'Any' (undefined postedBucket) — nothing was applied, so nothing to name", () => {
    const s: FilterState = { ...base, postedBucket: undefined };
    const entries = activeFilterEntries(s, { includeQuietDefaults: true });
    assert.equal(entries.length, 0);
});

test("zero-result state names the quiet default ALONGSIDE already-active filters — proves the class, not a posted-bucket special case", () => {
    const s: FilterState = { ...base, salaryMin: 100_000, visaOnly: true, postedBucket: "30d" };
    const entries = activeFilterEntries(s, { includeQuietDefaults: true });
    assert.deepEqual(entries.map((e) => e.key).sort(), ["postedBucket", "salaryMin", "visaOnly"]);
});

test("zero-result state's quiet-default entry WIDENS on clear — 30d is a fixed point, so it must clear to explicit Any, not back to itself", () => {
    const entries = activeFilterEntries(base, { includeQuietDefaults: true });
    const cleared = entries[0].clear(base);
    assert.equal(cleared.postedBucket, undefined);
    assert.equal(cleared.postedExplicit, true);
    assert.notDeepEqual(cleared, base);
});

test("explicit 30d is an active posted filter entry in the toolbar", () => {
    const s: FilterState = { ...base, postedExplicit: true };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "postedBucket");
    assert.equal(entries[0].label, "Last 30 days");
});

test("clearing explicit 30d restores the quiet default", () => {
    const s: FilterState = { ...base, postedExplicit: true };
    const cleared = activeFilterEntries(s)[0].clear(s);
    assert.equal(cleared.postedBucket, "30d");
    assert.equal(cleared.postedExplicit, undefined);
});

test("a non-pristine bucket's clear is unchanged by this fix — 7d still clears back to pristine 30d", () => {
    const s: FilterState = { ...base, postedBucket: "7d" };
    const entries = activeFilterEntries(s);
    assert.equal(entries[0].clear(s).postedBucket, "30d");
    assert.equal(entries[0].clear(s).postedExplicit, undefined);
});

test("class-wide guard: the widened state round-trips through the URL as explicit Any, not a silent re-narrow on reload", () => {
    const entries = activeFilterEntries(base, { includeQuietDefaults: true });
    const cleared = entries[0].clear(base);
    const urlState: JobsUrlState = { ...DEFAULT_URL_STATE, ...cleared, postedExplicit: true };
    const qs = serializeJobsUrl(urlState);
    assert.match(qs, /posted=any/);
    assert.equal(parseJobsUrl(new URLSearchParams(qs)).postedBucket, undefined);
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

test("STATIC_FACET_LADDERS seeds the canonical work/experience/employment values", () => {
    // experience_level/employment_type widened 2026-08-08 (F3, facet-capabilities
    // wave) to the full live corpus vocabulary — lead/executive/intern and
    // part_time/internship were previously unfilterable. Asserted against the
    // shared EXPERIENCE_LEVELS/EMPLOYMENT_TYPES source rather than re-typing the
    // list here, so this test can never itself drift from that one source.
    assert.deepEqual(STATIC_FACET_LADDERS.work_type, WORK_TYPES);
    assert.deepEqual(STATIC_FACET_LADDERS.experience_level, EXPERIENCE_LEVELS);
    assert.deepEqual(STATIC_FACET_LADDERS.employment_type, EMPLOYMENT_TYPES);
});

// ---------------------------------------------------------------------------
// Corpus scope is a filter (2026-08-24).
//
// `board=elite` restricts the whole search to an editorial allowlist of a few
// hundred domains out of ~75k companies. It used to live OUTSIDE `FilterState`,
// which meant `activeFilterEntries` could not emit a chip for it, "clear
// filters" could not reach it, and `buildUrlState` re-spread it into every new
// query — so a Canada search for "software engineer" returned 78 rows instead
// of 1,775, on one device only (it is URL state), with nothing on screen saying
// why. These tests pin the seam, not the symptom: they assert that a scope that
// narrows the corpus is a member of the one collection every clear reads.
// ---------------------------------------------------------------------------

test("board is an active entry, labelled from BOARD_META, and its clear drops it", () => {
    const s: FilterState = { ...base, board: "elite" };
    const entries = activeFilterEntries(s);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "board");
    assert.equal(entries[0].label, BOARD_META.elite.label);
    assert.equal(entries[0].clear(s).board, null);
    assert.equal(activeFilterEntries(entries[0].clear(s)).length, 0);
});

test("board's chip renders standalone — its key carries no facet prefix", () => {
    const entry = activeFilterEntries({ ...base, board: "elite" })[0];
    // Colon-free key: `entriesNeedingOwnChip` splits on ":" to recover a facet
    // key, so a colon here would make the chip row look for a FacetBar control
    // named "board" and silently swallow the chip when one existed.
    assert.equal(entry.key.includes(":"), false);
    assert.equal(chipLabelForEntry(entry), BOARD_META.elite.label);
    assert.deepEqual(
        entriesNeedingOwnChip([entry], new Set(["location_country"])).map((e) => e.key),
        ["board"],
    );
});

// The OTHER case of the same class (generic-fix rule): `companyDomain` never
// showed the symptom — the SERP already renders a dedicated employer token for
// it — but it had the identical structural defect, sitting outside the
// collection that "clear all" and "clear search" reset. Membership is the fix;
// it deliberately emits no entry of its own, because a second chip for one
// scope is the duplicate-affordance regression this row was cleaned of once.
test("companyDomain is cleared by pristine, yet emits no second chip", () => {
    const s: FilterState = { ...base, companyDomain: "harrods.com" };
    assert.equal(activeFilterEntries(s).length, 0);
    assert.equal(PRISTINE_FILTER_STATE.companyDomain, null);
});

test("clearing all filters widens BOTH scopes back to the whole corpus", () => {
    // `panelClearAll` (page.tsx) is literally `applyFilterState(PRISTINE_FILTER_STATE)`,
    // so pristine's own fields are what "Clear filters · N" restores.
    assert.equal(PRISTINE_FILTER_STATE.board, null);
    assert.equal(PRISTINE_FILTER_STATE.companyDomain, null);
    assert.equal(activeFilterEntries({ ...base, board: "elite", companyDomain: "harrods.com" }).length, 1);
    assert.equal(activeFilterEntries(PRISTINE_FILTER_STATE).length, 0);
});
