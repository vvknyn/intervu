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
 * The fix moved the queue-write INSIDE `handleUploadClick` itself (the one
 * chokepoint every entry point already had to call to open the modal) —
 * every caller gets the correct behavior just by calling
 * `handleUploadClick()`, with no continuation choice left to forget (the
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
    const body = section("const handleImport = (data: ResumeData", "const notConnected =");
    assert.match(body, /queuedAction\?\.kind === "fit"/);
    assert.match(body, /fitIntentRef\.current!\.isCurrent\(queuedAction\.fitToken\)/);
});

/**
 * "My résumé" toolbar control (2026-08-15 follow-up) — replaced the old
 * two-state "Upload résumé" button, which told a RETURNING user with a
 * résumé already on file to "upload" one because `resume` local state is
 * never fetched at mount (Task 4). One control, one label; only the STYLE
 * (`resolveResumeControlState`) changes.
 *
 * A 2026-08-15 follow-up fix caught a second-order version of the SAME bug:
 * an earlier version of `handleMyResumeClick` decided its branch off
 * `resumeOnFile`'s rendered STYLE hint instead of its truth, which (a)
 * reopened the "upload" flow for a window of a few hundred ms on every
 * returning visit (the presence check starts unknown/`null`, which the old
 * code folded into "no résumé"), and (b) went dead-silent if a résumé
 * `resumeOnFile` claimed was present failed to actually resolve. The click
 * decision moved OUT of page.tsx entirely into `runResumeControlClick`
 * (lib/jobs/result-state.ts, unit-tested there with injected spies) —
 * this test's job is just to prove page.tsx actually delegates to it
 * instead of re-implementing (and risking re-diverging) the same branching
 * inline.
 */
test("handleMyResumeClick delegates its whole branch decision to runResumeControlClick — no local if/else re-implementing it", () => {
    const body = section("const handleMyResumeClick = () => {", "const handleImport = (data: ResumeData");
    assert.match(
        body,
        /runResumeControlClick\(resumeOnFile,\s*resolveAndApplyFit,\s*handleUploadClick\)/,
        "expected handleMyResumeClick to call runResumeControlClick(resumeOnFile, resolveAndApplyFit, handleUploadClick)",
    );
    assert.doesNotMatch(
        body,
        /if\s*\(/,
        "the branch decision must live in runResumeControlClick, not a local if/else in page.tsx",
    );
});

test('the "My résumé" control is never disabled — muted state stays clickable/focusable (a11y)', () => {
    const body = section('data-testid="jobs-my-resume"', "My résumé");
    assert.doesNotMatch(body, /\bdisabled\b/);
    assert.match(body, /aria-label=/);
});

// 2026-08-15 a11y follow-up — measured (headless render, computed colour
// over the real page backdrop): the muted state's `/60` opacity modifier put
// this interactive control at 2.25:1, below WCAG AA's 4.5:1 floor for
// 12px/normal text. The fix carries the muted/active distinction by
// weight/colour token instead (never opacity, size, or a lighter token), so
// this guards against the exact regression class: any opacity modifier, a
// smaller font size, or a `/NN` alpha suffix reappearing on this control.
test('the "My résumé" control never carries its muted/active state via opacity, a lighter alpha token, or a smaller font size', () => {
    const body = section('data-testid="jobs-my-resume"', "My résumé");
    assert.doesNotMatch(body, /text-muted-foreground\/\d+/, "no alpha-suffixed muted-foreground token");
    assert.doesNotMatch(body, /\bopacity-\d+/, "no opacity utility");
    assert.doesNotMatch(body, /text-\[1[01]px\]/, "no smaller-than-12px font size");
});

test('the "My résumé" control wraps its click handler — never handed to onClick bare', () => {
    assert.doesNotMatch(
        SOURCE,
        /onClick=\{handleMyResumeClick\}/,
        "handleMyResumeClick must never be passed bare — wrap it in `() => handleMyResumeClick()`",
    );
});
