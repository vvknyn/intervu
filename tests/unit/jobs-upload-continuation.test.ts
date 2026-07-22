import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Grep-proof" class-fix regression test for the résumé-upload continuation
 * wiring in src/app/jobs/page.tsx.
 *
 * Bug this guards against (user-reported): the résumé-upsell card called
 * `handleUploadClick` directly as its click handler, with no follow-up
 * wiring. Every OTHER upload entry point (`handleRankByFit`,
 * `handleExploreClick`) separately set `resumeActionAfterImportRef.current`
 * themselves, right after calling `handleUploadClick()` — so the upsell
 * card's upload queued no continuation, and completing it silently did
 * nothing: no fit-ranking, no "Ranked by your résumé" chip, no re-rank.
 *
 * The fix moves the queue-write INSIDE `handleUploadClick` itself (the one
 * chokepoint every entry point already had to call to open the modal),
 * defaulting to `"fit"` — so a future entry point can't repeat this bug by
 * forgetting a second call; it gets the correct behavior just by calling
 * `handleUploadClick()`.
 *
 * `handleUploadClick`'s flow is async, auth-gated, and React-state-driven —
 * this repo has no component-render test harness (no @testing-library /
 * jsdom / vitest dependency), so it can't be exercised directly by
 * node:test. These tests instead prove the STATIC invariants that make the
 * class fix hold, reading the actual page.tsx source: every current entry
 * point routes through the chokepoint, and nothing bypasses it to write the
 * continuation ref or open the modal directly.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");

function section(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

test("resumeActionAfterImportRef.current is assigned in exactly 3 places: clearPendingGate (clear), handleUploadClick (queue), handleImport (clear-on-read)", () => {
    const assignments = SOURCE.match(/resumeActionAfterImportRef\.current\s*=/g) ?? [];
    // A 4th assignment site anywhere in the file means a new entry point
    // bypassed `handleUploadClick` and wrote the continuation itself —
    // exactly the class of bug this fix closes.
    assert.equal(assignments.length, 3, `expected 3 assignment sites, found ${assignments.length}`);
});

test("setImportOpen(true) is called in exactly 2 places: handleUploadClick, and the post-auth replay", () => {
    const opens = SOURCE.match(/setImportOpen\(true\);/g) ?? [];
    // The replay case (`maybeReplay`'s "upload" branch) is legitimate: it
    // re-opens a modal `handleUploadClick` already queued the continuation
    // for, before the auth popover interrupted it. Any OTHER call site
    // opens the modal without having gone through the chokepoint that
    // queues what happens when it closes.
    assert.equal(opens.length, 2, `expected 2 setImportOpen(true) call sites, found ${opens.length}`);
});

test("handleRankByFit routes its no-résumé fallback through handleUploadClick (default \"fit\" continuation), not a direct ref write", () => {
    const body = section('const handleRankByFit = async () => {', "// Compact Explore button");
    assert.match(body, /handleUploadClick\(\);/);
    assert.doesNotMatch(body, /resumeActionAfterImportRef\.current\s*=/);
});

test("handleExploreClick routes its no-résumé fallback through handleUploadClick(\"explore\"), not a direct ref write", () => {
    const body = section('const handleExploreClick = async () => {', "// Task 11 review fix");
    assert.match(body, /handleUploadClick\("explore"\);/);
    assert.doesNotMatch(body, /resumeActionAfterImportRef\.current\s*=/);
});

test("the résumé-upsell card wraps handleUploadClick in a no-arg closure, never passes it bare", () => {
    // Bare `onUpload={handleUploadClick}` would let React's click event
    // flow through as `handleUploadClick`'s first argument (`intent`),
    // silently miscoercing "fit" into something else at runtime — the
    // exact footgun this call site must avoid.
    assert.match(SOURCE, /onUpload=\{\(\) => handleUploadClick\(\)\}/);
    assert.doesNotMatch(SOURCE, /onUpload=\{handleUploadClick\}/);
});

test("handleImport respects the fitIntentRef guard before applying a queued fit continuation", () => {
    const body = section("const handleImport = (data: ResumeData", "const startOver = ()");
    assert.match(body, /queuedAction\?\.kind === "fit"/);
    assert.match(body, /fitIntentRef\.current!\.isCurrent\(queuedAction\.fitToken\)/);
});
