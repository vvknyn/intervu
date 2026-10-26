import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveCorpusCount, formatCorpusCount, CORPUS_COUNT_CAP } from "../../src/lib/jobs/corpus-count";

/**
 * Regression for a rendered 390px screenshot: a returning visitor with an
 * old cursor saw "100000 new roles posted since your last visit" — a bare,
 * unseparated Meilisearch `total` that had saturated at the 100,000
 * `maxTotalHits` cap (see corpus-count.ts). `countNewSinceAction`
 * (actions/jobs.ts) now resolves through `resolveCorpusCount` the same way
 * every other search-total display site does, so its result can only ever
 * reach the UI as a `CorpusCount`, never a raw number.
 */

test("count-new pipeline: a capped, facet-less 'new since cursor' probe renders as an honest floor, not a bare 100000", () => {
    // Shape countNewSinceAction actually queries with (`withFacets: false`,
    // `limit: 1`) — no facetDistribution ever comes back on this path, so
    // the ghost_badge escape hatch in resolveCorpusCount can never fire
    // here and a capped total always lands on `floor`.
    const capped = resolveCorpusCount({ total: CORPUS_COUNT_CAP });
    assert.deepEqual(capped, { kind: "floor", value: CORPUS_COUNT_CAP });
    assert.equal(formatCorpusCount(capped), "100,000+");
});

test("count-new pipeline: an ordinary, un-capped count renders comma-grouped, not '9184'", () => {
    const ordinary = resolveCorpusCount({ total: 9_184 });
    assert.deepEqual(ordinary, { kind: "exact", value: 9_184 });
    assert.equal(formatCorpusCount(ordinary), "9,184");
});

/**
 * This repo has no component-render harness (no @testing-library/jsdom —
 * see tests/unit/jobs-list-tail.test.ts), so — same approach used there —
 * these prove the STATIC invariant that makes the class fix hold: the
 * render call site must route the count through `formatCorpusCount`, never
 * interpolate the `CorpusCount`/number directly. Mutating either component
 * back to raw interpolation (`{count}` / `+{newCounts[s.id]}`) makes the
 * matching test below fail — verified by hand for this change (mutate, run,
 * restore), not asserted by a further test, since asserting "the test file
 * fails" from inside itself is circular.
 */
const BANNER_SOURCE = readFileSync(
    join(__dirname, "../../src/components/jobs/BoardVisitBanner.tsx"),
    "utf8",
);
const SAVED_SEARCHES_SOURCE = readFileSync(
    join(__dirname, "../../src/components/jobs/SavedSearchesPanel.tsx"),
    "utf8",
);

test("BoardVisitBanner renders the count through formatCorpusCount, never raw", () => {
    assert.match(BANNER_SOURCE, /\{formatCorpusCount\(count\)\}/);
    // The literal raw-interpolation bug this guards against: a bare
    // `{count}` (not wrapped in `formatCorpusCount(...)`) sitting in the
    // same paragraph of copy.
    assert.doesNotMatch(BANNER_SOURCE, /text-brand tabular-nums">\{count\}</);
});

test("SavedSearchesPanel's saved-search 'N new' chip (a second countNewSinceAction call site) also formats through formatCorpusCount", () => {
    assert.match(SAVED_SEARCHES_SOURCE, /\{formatCorpusCount\(count\)\} new/);
    assert.doesNotMatch(SAVED_SEARCHES_SOURCE, />\{count\}</);
    assert.doesNotMatch(SAVED_SEARCHES_SOURCE, />\+\{newCounts\[s\.id\]\}</);
});
