import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSearchIntent, type SearchIntentInput } from "../../src/lib/jobs/search-intent";

// Front door (2026-09-30, the journey map's "a list needs a reason" rule,
// superseding the 2026-09-22 at-rest recency feed): arriving at /jobs with
// nothing typed, filtered or open is not search intent, so the at-rest
// Search home fetches and shows no rows. `hasSearchIntent` remains the single
// predicate deciding "results surface" vs "at-rest front door" — see its doc
// comment (src/lib/jobs/search-intent.ts) for what each clause means.

const REST: SearchIntentInput = {
    query: "",
    filtersAwayFromDefault: false,
    explicitlySubmitted: false,
    jobOpen: false,
    fitActive: false,
};

test("at rest (nothing set) has no search intent", () => {
    assert.equal(hasSearchIntent(REST), false);
});

test("empty query with an explicit submit ('browse all') has search intent", () => {
    assert.equal(hasSearchIntent({ ...REST, explicitlySubmitted: true }), true);
});

test("a filter/sort away from default alone has search intent, with no query and no submit", () => {
    assert.equal(hasSearchIntent({ ...REST, filtersAwayFromDefault: true }), true);
});

test("a URL-carried job open alone has search intent, with no query and no submit", () => {
    assert.equal(hasSearchIntent({ ...REST, jobOpen: true }), true);
});

test("For-you active alone has search intent, with no query and no submit", () => {
    assert.equal(hasSearchIntent({ ...REST, fitActive: true }), true);
});

test("a query typed then cleared before any submit has no search intent — nothing lingers on the transient query alone", () => {
    // Simulates the caller's live state after "typed, then backspaced to
    // empty, never hit Enter": query is back to "" and explicitlySubmitted
    // was never set. Proves the predicate holds no residual state of its
    // own for the transient clauses — only `explicitlySubmitted` is sticky,
    // and it isn't set here.
    assert.equal(hasSearchIntent({ ...REST, query: "" }), false);
});
