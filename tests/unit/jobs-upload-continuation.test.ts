import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Grep-proof" class-fix regression test for the résumé-upload continuation
 * wiring in src/app/jobs/page.tsx (lived in src/app/page.tsx until the
 * board became the front page and `/` became a redirect).
 *
 * Bug this guards against (user-reported): the résumé-upsell card called
 * `handleUploadClick` directly as its click handler, with no follow-up
 * wiring. `handleRankByFit` separately set
 * `resumeActionAfterImportRef.current` itself, right after calling
 * `handleUploadClick()` — so the upsell card's upload queued no
 * continuation, and completing it silently did nothing: no fit-ranking, no
 * "Ranked by your résumé" chip, no re-rank.
 *
 * The fix moved the queue-write INSIDE the importer's own entry point (the
 * one chokepoint every caller already had to go through to open the modal —
 * `beginResumeUpload`, which `handleUploadClick` calls directly) — every
 * caller gets the correct behavior just by calling it, with no continuation
 * choice left to forget (the
 * only résumé-driven continuation left is "fit"; a second one, "explore",
 * existed here through 2026-08-02 — removed with the feature it drove).
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

test("resumeActionAfterImportRef.current is assigned in exactly 3 places: clearPendingGate (clear), beginResumeUpload (queue), handleImport (clear-on-read)", () => {
    const assignments = SOURCE.match(/resumeActionAfterImportRef\.current\s*=/g) ?? [];
    // A 4th assignment site anywhere in the file means a new entry point
    // bypassed `beginResumeUpload` and wrote the continuation itself —
    // exactly the class of bug this fix closes. It has caught one for real:
    // the search-prefs wizard's "Add résumé" step (2026-08-23) queued the
    // continuation AND opened the modal itself, skipping the signed-out auth
    // gate; the fix folded it back into the chokepoint.
    assert.equal(assignments.length, 5, `expected 5 assignment sites, found ${assignments.length}`);
});

test("setImportOpen(true) is called in exactly 2 places: beginResumeUpload, and the post-auth replay", () => {
    const opens = SOURCE.match(/setImportOpen\(true\);/g) ?? [];
    // The replay case (`maybeReplay`'s "upload" branch) is legitimate: it
    // re-opens a modal `beginResumeUpload` already queued the continuation
    // for, before the auth popover interrupted it. Post-auth `?resume=gate`
    // routes through `beginResumeUpload()` — not a third direct open.
    assert.equal(opens.length, 2, `expected 2 setImportOpen(true) call sites, found ${opens.length}`);
});

test("post-auth resume gate routes through beginResumeUpload and ResumeImportModal funnel context", () => {
    assert.match(SOURCE, /POST_AUTH_RESUME_GATE_PARAM/);
    assert.match(SOURCE, /authGateReasonToFunnelReason\(attempt\?\.lastGateReason\)/);
    assert.match(SOURCE, /beginResumeUpload\(\)/);
    assert.match(SOURCE, /funnelContext=\{\{ \.\.\.importFunnelContext, signed_in: Boolean\(user\) \}\}/);
});

test("handleRankByFit routes its no-résumé fallback through handleUploadClick (default \"fit\" continuation), not a direct ref write", () => {
    const body = section('const handleRankByFit = async () => {', "// Task 11 review fix");
    assert.match(body, /handleUploadClick\(\);/);
    assert.doesNotMatch(body, /resumeActionAfterImportRef\.current\s*=/);
});

test("handleUploadClick is never handed to a handler prop bare — always wrapped", () => {
    // Bare `onClick={handleUploadClick}` would let React's click event flow
    // through as `handleUploadClick`'s first argument (`intent`), silently
    // miscoercing "fit" into something else at runtime — the exact footgun
    // every call site must avoid.
    //
    // Asserted against ANY handler prop rather than the old
    // `onUpload={...}` on the résumé-upsell card: the Phase 1 redesign
    // replaced that card with the Screen 9 résumé line, and pinning the
    // rule to one prop name meant it stopped being checked the moment the
    // caller moved.
    assert.match(SOURCE, /handleUploadClick\(\)/, "expected at least one wrapped call site");
    assert.doesNotMatch(
        SOURCE,
        /on[A-Z]\w*=\{handleUploadClick\}/,
        "handleUploadClick must never be passed bare — wrap it in `() => handleUploadClick()`",
    );
});

test("handleImport respects the fitIntentRef guard before applying a queued fit continuation", () => {
    const body = section("const handleImport = (", "const notConnected =");
    assert.match(body, /queuedAction\?\.kind === "fit"/);
    assert.match(body, /fitIntentRef\.current!\.isCurrent\(queuedAction\.fitToken\)/);
});

