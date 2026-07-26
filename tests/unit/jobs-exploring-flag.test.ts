import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Grep-proof" class-fix regression test for the Explore spinner/disabled-
 * state in src/app/page.tsx.
 *
 * Bug: `exploring` was raw state, set/cleared ONLY inside `runExplore`'s own
 * `finally`. But `applyFit`, `enterBrowse`/`enterBrowseAndSync`, `startOver`,
 * and typing mid-explore all supersede an in-flight explore (they bump
 * `exploreIntentRef`) WITHOUT clearing it — so the Explore button stayed
 * disabled/spinning for up to `EXPLORE_SUGGEST_TIMEOUT_MS` (25s) over
 * results the user had already navigated away to.
 *
 * Fix: `exploring` is now DERIVED from the same guard every superseding
 * handler already bumps, instead of being cleared per-handler — the
 * chokepoint fix. See jobs-upload-continuation.test.ts for why this repo
 * uses source-text assertions for page.tsx's un-exported closures (no
 * component-render test harness).
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/page.tsx"), "utf8");

test("exploring is derived from exploreIntentRef's current generation, not raw state read directly", () => {
    assert.match(
        SOURCE,
        /const exploring = exploringRaw && exploreIntentRef\.current!\.isCurrent\(exploringTokenRef\.current \?\? -1\);/,
    );
});

test("runExplore records its guard token into exploringTokenRef before flipping exploringRaw true", () => {
    const start = SOURCE.indexOf("const runExplore = async (r: ResumeData) => {");
    assert.ok(start !== -1);
    const body = SOURCE.slice(start, start + 400);
    const tokenIdx = body.indexOf("exploringTokenRef.current = token;");
    const rawTrueIdx = body.indexOf("setExploringRaw(true);");
    assert.ok(tokenIdx !== -1 && rawTrueIdx !== -1 && tokenIdx < rawTrueIdx);
});

test("every action that supersedes an in-flight explore (applyFit, enterBrowse, typing mid-explore) bumps exploreIntentRef — 4 call sites total", () => {
    const bumps = SOURCE.match(/exploreIntentRef\.current!\.begin\(\);/g) ?? [];
    // 1 inside runExplore itself (a fresh explore supersedes a stale one) +
    // 3 superseding call sites (applyFit, enterBrowse, the pinned search
    // box's onChange) = 4. A 5th anywhere would mean a new superseding
    // action was added without going through this same guard — and since
    // `exploring` is DERIVED from it, that new action would automatically
    // clear the spinner too, no separate fix needed.
    //
    // Was 5 until the Phase 1 redesign removed `startOver` along with the
    // ModeBar that was its only trigger. Clearing the query now returns the
    // searcher to Screen 1, which is only reachable in browse mode
    // (`showAsk` requires it), so there is no in-flight explore left to
    // supersede on that path.
    assert.equal(bumps.length, 4, `expected 4 begin() call sites, found ${bumps.length}`);
});

test("setExploring (the old raw setter, replaced by setExploringRaw) is not called anywhere", () => {
    // Matches a real call `setExploring(...)`, not the identifier
    // `setExploringRaw` (word boundary after `setExploring` would otherwise
    // also match that legitimate name's prefix).
    assert.doesNotMatch(SOURCE, /setExploring\(/);
});
