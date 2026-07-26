import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Grep-proof" class-fix regression test for Explore's URL contract in
 * src/app/page.tsx (design decision, 2026-07-21 review).
 *
 * Two proven bugs in the prior design (persisting Explore's derived query to
 * the URL): (1) the write was gated on `fitActiveRef.current`, so the COMMON
 * path — Explore from plain browse, not from a stale "ranked by résumé"
 * claim — left the address bar completely stale, desynced from what was
 * actually showing. (2) even when the write DID fire, `mode` itself was
 * never URL-represented, so reloading a "synced" explore URL landed on
 * `mode === "browse"` and rendered the derived query VERBATIM in the search
 * box — contradicting task (b)'s own fix (never show query soup).
 *
 * The fix: Explore is now ephemeral, session-only state. The URL
 * deliberately does not represent it — `activateExplore` resets q/facets/
 * sort to browse-default instead of writing the derived query, and the
 * URL-reconcile effect skips re-deriving q/facets from the URL while
 * `mode === "explore"` (so its OWN reset write can't immediately stomp the
 * local explore query it just set).
 *
 * `activateExplore` and the reconcile effect are closures inside a client
 * component with no component-render test harness in this repo (no
 * @testing-library/jsdom/vitest). These tests prove the static invariants
 * that make the design hold, reading the actual page.tsx source — same
 * methodology as tests/unit/jobs-upload-continuation.test.ts.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/page.tsx"), "utf8");

function section(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

test("composeExploreActivationUrlState is gone — nothing in page.tsx persists Explore's derived query to the URL", () => {
    assert.doesNotMatch(SOURCE, /composeExploreActivationUrlState/);
});

test("activateExplore resets the URL to browse-default (empty q, no facets, no sort) instead of writing the derived query", () => {
    const body = section("const activateExplore = (q: string) => {", "const enterExplore = async");
    // The `applyUrlState` call must be the LITERAL browse-default reset
    // `{ q: "", facets: {}, sort: null }` — not a derivation that could
    // smuggle the `q` parameter (the derived explore query) into the URL.
    // `setQuery(q)` (local state) is the only place the parameter is used.
    assert.match(body, /setQuery\(q\);/);
    assert.match(body, /applyUrlState\(buildUrlState\(\{ q: "", facets: \{\}, sort: null \}\), "replace"\);/);
});

test("the URL-reconcile effect does not re-derive query/facets from the URL while mode is \"explore\"", () => {
    const body = section("if (parsedKey !== currentKey) {", "setSalaryMin(parsed.salaryMin);");
    assert.match(body, /if \(modeRef\.current !== "explore"\) \{/);
    // setQuery/setFacets must be INSIDE that guard, not siblings of it.
    const guardIdx = body.indexOf('if (modeRef.current !== "explore")');
    const setQueryIdx = body.indexOf("setQuery(parsed.q)");
    const setFacetsIdx = body.indexOf("if (facetsChanged) setFacets(parsed.facets)");
    assert.ok(guardIdx !== -1 && setQueryIdx > guardIdx, "setQuery(parsed.q) must be inside the modeRef guard");
    assert.ok(setFacetsIdx > guardIdx, "setFacets(parsed.facets) must be inside the modeRef guard");
});

test("the search box shows empty-with-placeholder while explore mode is active — the derived query is never displayed raw", () => {
    assert.match(SOURCE, /value=\{mode === "explore" \? "" : query\}/);
});

test("explore mode is named on screen and dismissible while it is active", () => {
    // The Phase 1 redesign moved this from the deleted legend row onto the
    // result line, and from a `&&` chip to the first branch of the mode
    // ternary there. What must not change: explore mode is BOTH visible and
    // leavable. The box blanks itself while exploring (asserted above), so
    // without this the searcher sees unexplained results over an empty box
    // with no way back.
    assert.match(SOURCE, /mode === "explore" \? \(/);
    assert.match(SOURCE, /exploring roles adjacent to your résumé/i);
    const body = section('{mode === "explore" ? (', ") : fitActive ? (");
    assert.match(body, /onClick=\{\(\) => enterBrowseAndSync\(\)\}/, "the label must actually leave explore mode");
});
