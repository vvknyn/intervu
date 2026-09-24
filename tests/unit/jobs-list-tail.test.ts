import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Grep-proof" class-fix regression test for the results-list tail in
 * src/app/jobs/page.tsx (`ListTail`).
 *
 * Bug this guards against (user-reported): affordances rendered
 * unconditionally at the very bottom of the results container, AFTER the
 * load-more sentinel. While the list can still grow (browse-by-default's
 * default state, always), that position is never reached — an affordance
 * stranded below infinite scroll.
 *
 * The fix: `ListTail` owns everything rendered at the foot of the list —
 * the end-of-list line and the seed shortcuts — and early-returns `null` on
 * `resolveEndOfListState`'s `"more-available"` value BEFORE any JSX, so the
 * guard is structural (holds even if a future caller stops wrapping the
 * call site in `hasMore ?`), not a comment a future edit can silently
 * invalidate.
 *
 * The prep seed line itself is GONE (2026-08-08, Vivek: "that prep link is
 * still there... get rid of it") — the tracker's own persistent "Track a
 * role" button (/yours) is the manual-pursuit entry point now, so the
 * assertions that pinned its two sanctioned call sites are assertions of
 * ABSENCE below. The structural below-sentinel invariants stay exactly as
 * they were: they were never about that one component.
 *
 * This repo has no component-render test harness (no @testing-library /
 * jsdom / vitest dependency), so — same approach as
 * jobs-upload-continuation.test.ts — these tests prove the STATIC
 * invariants that make the class fix hold, reading the actual page.tsx
 * source.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");

function section(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

const LIST_TAIL_BODY = section("function ListTail({", "\nfunction JobsContent() {");

test("ListTail early-returns null on \"more-available\" before any JSX — the guard is structural, not positional", () => {
    // Anchored to line-start (only leading whitespace before `if`) so a
    // future edit that comments the guard out (`// if (...) return null;`)
    // fails this test instead of passing on the dead substring.
    const guardMatch = LIST_TAIL_BODY.match(/^\s*if \(endOfListState === "more-available"\) return null;/m);
    assert.ok(guardMatch, 'expected a LIVE (uncommented) early-return guard on "more-available"');
    const guardIndex = guardMatch!.index!;
    const firstJsxReturnIndex = LIST_TAIL_BODY.indexOf("return (");
    assert.notEqual(firstJsxReturnIndex, -1, "expected a JSX return in ListTail's body");
    assert.ok(
        guardIndex < firstJsxReturnIndex,
        "the \"more-available\" early return must appear before the JSX return — otherwise something could render first",
    );
});

test("the prep seed line is gone from the board entirely — component, call sites, testids and copy", () => {
    for (const gone of [/SearchSeedLine/, /prep-seed-line/, /prep-seed-form/, /Already interviewing somewhere/, /Prep for it/]) {
        assert.doesNotMatch(SOURCE, gone, `expected no trace of the prep seed line: ${gone}`);
    }
    // Its submit handler and in-flight state go with it — a dead handler
    // left behind is the "delete what the change obsoletes" miss this
    // assertion exists to catch.
    assert.doesNotMatch(SOURCE, /handleSeedSubmit|seedSubmitting/);
});

test("the standalone pivot seed row above the results pane is gone (ITEM H, 2026-08-15) — seeds moved into the search box's own focus dropdown", () => {
    for (const gone of [/shouldShowBrowseSeedRow/, /emptySearchState !== "results" && !isSerpAsk/]) {
        assert.doesNotMatch(SOURCE, gone, `expected no trace of the standalone pivot row's gate: ${gone}`);
    }
    // BrowseSeedRow now has exactly two call sites left — EmptyResultsState's
    // and ListTail's own (both genuine no-results/end-of-list surfaces, not
    // this one) — proving the pivot-row instance is gone without a third
    // row having crept back in.
    const browseSeedRowCallSites = SOURCE.match(/<BrowseSeedRow\b/g) ?? [];
    assert.equal(browseSeedRowCallSites.length, 2);
    // The search box now carries the seeds instead.
    assert.match(SOURCE, /<SearchAutocomplete[\s\S]*?seeds=\{searchSeeds\}/);
});

test("BrowseSeedRow's tail usage lives inside ListTail's own guard", () => {
    // Not the surfacing instance: this proves the class fix, not just the
    // one component the bug report named — the SAME early return also
    // protects BrowseSeedRow's tail-position call site, which a narrower,
    // SearchSeedLine-only fix could easily have left stranded.
    assert.match(LIST_TAIL_BODY, /<BrowseSeedRow\b/);
    // And exactly once — the two former per-branch (`cap-reached` /
    // `genuine-end`) duplicate rows are now one shared row behind the one
    // guard, not two.
    const tailBrowseSeedRows = LIST_TAIL_BODY.match(/<BrowseSeedRow\b/g) ?? [];
    assert.equal(tailBrowseSeedRows.length, 1);
});

test("nothing interactive renders in the results-container source after ListTail's call site — the tail is last", () => {
    // End marker is the page-level résumé band that follows the results
    // ternary — not part of the list container. (`<LocationPickerSheet`
    // used to be the next sibling; the band now sits between the feed and
    // that sheet so the first viewport is jobs, not the upload invite.)
    const afterTailCallSite = section("<ListTail", "{frontDoorBandVisible &&");
    assert.doesNotMatch(
        afterTailCallSite,
        /onClick=|<button\b/,
        "found an interactive element after ListTail's call site — the tail is no longer the last thing rendered",
    );
});

test("ListTail is called unconditionally (not re-gated by a hasMore ternary/&&) — the ONLY guard is its own early return", () => {
    // A caller-side `hasMore ? null : <ListTail ... />` or
    // `!hasMore && <ListTail ... />` would duplicate the invariant in two
    // places (writing-lean-code rule 2: single source of truth) — the ONLY
    // thing keeping the tail off-screen while the list can grow must be
    // ListTail's own early return, not a second copy of the condition at
    // the call site.
    assert.doesNotMatch(
        SOURCE,
        /hasMore\s*(\?|&&|\|\|)[^<]*<ListTail/,
        "found a hasMore-conditional operator between a hasMore reference and ListTail's call site",
    );
    const callSite = section("<ListTail", "/>");
    assert.match(callSite, /endOfListState=\{endOfListState\}/);
});
