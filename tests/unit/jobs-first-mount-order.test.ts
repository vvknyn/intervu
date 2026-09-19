import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveEmptySearchState } from "../../src/lib/jobs/result-state";

// Perf first-paint (2026-09-18) step 2: the search must be the FIRST action
// jobs/page.tsx dispatches on mount. Before this change, three secondary
// mount probes (posted-date filter support, the report-listing flag, the
// masthead live-jobs count) fired their action calls synchronously in their
// own effect bodies, while the search effect's entire fetch sat behind an
// unconditional 250ms `setTimeout` — so on every mount the three probes hit
// the network first, competing with the search for the same in-flight
// request budget on the page that most needs its first result fast.
//
// Fix: the three probes are now gated behind a `firstSearchSettled` flag,
// set once inside the search effect's own `finally` (success, failure, or
// gate-denial all settle it — nothing waits on an eventual retry), and the
// search effect itself skips its debounce on its own very first (mount,
// URL-seeded) run.
//
// This repo has no component-render harness (no @testing-library/jsdom —
// see the comment in tests/unit/jobs-count-new-honesty.test.ts), so the
// ordering property is proven by parsing the real source, the same
// convention tests/unit/jobs-effect-dep-stability.test.ts established for
// an otherwise-unmountable runtime property.

const PAGE_SOURCE = readFileSync(join(process.cwd(), "src/app/jobs/page.tsx"), "utf8");

/** Effects that opt into the gate by depending on `firstSearchSettled` —
 *  found by the flag itself, not by naming which probes exist today, so a
 *  probe added later is covered by construction the moment it lists the
 *  dependency. */
function effectsDependingOnFlag(source: string): string[] {
    const re = /useEffect\([\s\S]*?\}, \[firstSearchSettled\]\);/g;
    return [...source.matchAll(re)].map((m) => m[0]!);
}

/** Effects whose very first statement guards on the flag, regardless of
 *  their dependency array — used to cross-check the count above rather than
 *  trust one regex alone. */
function guardedEffects(source: string): string[] {
    const re = /useEffect\(\(\) => \{\s*if \(!firstSearchSettled\) return;[\s\S]*?\}, \[firstSearchSettled\]\);/g;
    return [...source.matchAll(re)].map((m) => m[0]!);
}

test("at least 3 mount effects are gated on firstSearchSettled, and every one of them guards on it first", () => {
    const depending = effectsDependingOnFlag(PAGE_SOURCE);
    const guarded = guardedEffects(PAGE_SOURCE);
    assert.ok(depending.length >= 3, `expected >= 3 effects depending on firstSearchSettled, found ${depending.length}`);
    // Every effect that lists the flag as a dependency must ALSO guard on it
    // as its first statement — a probe that depends on the flag but forgets
    // the early return would still run once (on mount, before it flips)
    // exactly like the bug this fixes.
    assert.equal(
        guarded.length,
        depending.length,
        `${depending.length - guarded.length} effect(s) depend on firstSearchSettled without guarding on it first`,
    );
});

test("firstSearchSettled is only ever set inside the search effect itself — the probes never set it themselves", () => {
    // Perf first-paint (2026-09-18): the search effect gained a second exit —
    // an early return when there is no search intent (the at-rest page never
    // fetches, so nothing else would ever settle the flag for it) — alongside
    // the original `finally` once a real fetch concludes. Both belong to the
    // SAME effect, so the property this test guards is "every settle site
    // lives inside that one effect, and no probe effect settles it itself",
    // not "the string appears exactly once" (which the second legitimate
    // exit would now fail on its own).
    const settlers = [...PAGE_SOURCE.matchAll(/setFirstSearchSettled\(true\)/g)];
    assert.ok(settlers.length >= 1, "expected at least one call site that settles the flag");
    const searchEffect = /useEffect\(\(\) => \{\s*if \(!searchIntent\)[\s\S]*?\}, \[searchKey, searchRetry, emptySearchState, locationDefaultSuppressed, searchIntent\]\);/.exec(
        PAGE_SOURCE,
    );
    assert.ok(searchEffect, "expected to find the search effect bounded by its searchIntent guard and its own dependency array");
    const outsideSearchEffect = PAGE_SOURCE.replace(searchEffect![0], "");
    assert.doesNotMatch(
        outsideSearchEffect,
        /setFirstSearchSettled\(true\)/,
        "every settling call site must live inside the search effect itself",
    );
    // Sanity: none of the guarded probe effects are the one setting it —
    // that would be a probe marking its own gate open.
    for (const effect of guardedEffects(PAGE_SOURCE)) {
        assert.doesNotMatch(effect, /setFirstSearchSettled/);
    }
});

test("the search effect's debounce is a variable, not the unconditional literal 250 — its mount run must not wait", () => {
    const match = /const t = setTimeout\(async \(\) => \{[\s\S]*?\n {8}\}, (\w+)\);/.exec(PAGE_SOURCE);
    assert.ok(match, "expected to find the search effect's `const t = setTimeout(async () => {...}, <delay>)` call");
    assert.notEqual(match![1], "250", "the delay must be a variable (0 on first run, 250 after), not the old hardcoded debounce");
});

test("the first-run flag is flipped synchronously (before the debounced timeout body), so a fast second mount run can't also read itself as first", () => {
    const idx = PAGE_SOURCE.indexOf("isFirstSearchRunRef.current = false;");
    const timeoutIdx = PAGE_SOURCE.indexOf("const t = setTimeout(async () => {");
    assert.ok(idx !== -1, "expected isFirstSearchRunRef to be flipped off somewhere in the search effect");
    assert.ok(idx < timeoutIdx, "the ref must flip before the timeout is even scheduled, not inside its deferred body");
});

// The property above is generic to ANY mount shape, not only the pristine
// empty-query landing (which already special-cases through
// getDefaultBrowseAction — see result-state.ts's own doc comment on
// "overlay-ask"). Proven here with a non-pristine, URL-seeded case: a real
// query and no active filters. Both branches of the search effect's
// action-selection ternary (getDefaultBrowseActionGuarded for the pristine
// landing, searchJobsAction for everything else — page.tsx's
// `emptySearchState === "overlay-ask" ? ... : ...`) live inside the SAME
// effect that unconditionally settles the flag in its `finally`, so this
// non-pristine case proves the ordinary searchJobsAction path is covered by
// the same first-dispatch guarantee, not merely the special-cased one.
test("a non-pristine mount (real query, no filters) takes the ordinary search branch, not the pristine default-browse branch", () => {
    const state = resolveEmptySearchState({
        hasQuery: true,
        fitActive: false,
        activeFilterCount: 0,
        hasCorpusScope: false,
    });
    assert.notEqual(
        state,
        "overlay-ask",
        "a real query must resolve away from the pristine-landing branch so the ordinary searchJobsAction path is what actually runs first",
    );
});
