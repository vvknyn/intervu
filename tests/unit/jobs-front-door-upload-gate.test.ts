import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Front-door redesign, requirement 2: the at-rest band's "Upload resume"
 * button (signed out OR signed in) wires to `handleUploadClick`, the same
 * chokepoint every other résumé-upload entry point already goes through
 * (`beginResumeUpload` — see jobs-upload-continuation.test.ts for the
 * class-fix this chokepoint exists to enforce). This file proves that
 * chokepoint's actual auth-gate behavior — no @testing-library/jsdom in
 * this repo (see jobs-upload-continuation.test.ts's doc comment), so these
 * are static invariants read from the real page.tsx source, not a rendered
 * click.
 *
 * Product ruling (2026-09-17): résumé upload requires sign-in, full stop —
 * the gate is UNCONDITIONAL. Before this, `beginResumeUpload` let a
 * signed-out visitor through when local-AI (on-device parsing) was
 * enabled (`!user && !readLocalAiEnabled()`); that carve-out is gone. The
 * flag only ever changed WHERE parsing happens once a session exists, and
 * must not be readable as an escape hatch from the account gate.
 */
const SOURCE = readFileSync(join(__dirname, "../../src/app/jobs/page.tsx"), "utf8");

function section(startMarker: string, endMarker: string): string {
    const start = SOURCE.indexOf(startMarker);
    assert.ok(start !== -1, `could not find start marker: ${startMarker}`);
    const end = SOURCE.indexOf(endMarker, start);
    assert.ok(end !== -1, `could not find end marker: ${endMarker}`);
    return SOURCE.slice(start, end);
}

const beginResumeUpload = section("const beginResumeUpload = () => {", "const handleUploadClick = () => {");

test("page.tsx wires FrontDoorResumeBand's onUploadClick to handleUploadClick, wrapped (not bare)", () => {
    assert.match(SOURCE, /<FrontDoorResumeBand\s*\n\s*onUploadClick=\{\(\) => handleUploadClick\(\)\}/);
});

test("signed-out: beginResumeUpload sets auth-gate reason \"fit\" and calls gate({kind:\"upload\"}) — no import modal opens on this path", () => {
    const start = beginResumeUpload.indexOf("if (!user) {");
    assert.ok(start !== -1, "signed-out branch not found in beginResumeUpload");
    const end = beginResumeUpload.indexOf("}", beginResumeUpload.indexOf("return;", start));
    const branch = beginResumeUpload.slice(start, end + 1);
    assert.match(branch, /setAuthGateReason\("fit"\)/);
    assert.match(branch, /gate\(\{\s*kind:\s*"upload"/);
    // The whole point of gating: this branch must return before reaching
    // the signed-in path's setImportOpen(true) — no modal opens here.
    assert.doesNotMatch(branch, /setImportOpen\(true\)/);
    assert.match(branch, /return;/);
});

test("signed-in: beginResumeUpload opens the importer directly, without touching gate()", () => {
    const guestBranchEnd = beginResumeUpload.indexOf("return;", beginResumeUpload.indexOf("if (!user) {"));
    const afterGuestBranch = beginResumeUpload.slice(beginResumeUpload.indexOf("}", guestBranchEnd) + 1);
    assert.match(afterGuestBranch, /setImportOpen\(true\);/);
    assert.doesNotMatch(afterGuestBranch, /gate\(/);
});

test("signed-out + local-AI ENABLED still gates — the guard is exactly `!user`, not `!user && !readLocalAiEnabled()`", () => {
    // The class-wide case this bug actually shipped as: local-AI on used to
    // read as "no account needed". Assert the escape hatch is gone from the
    // guard's own condition, not just from behavior we happen to exercise.
    assert.doesNotMatch(beginResumeUpload, /if \(!user && !readLocalAiEnabled\(\)\)/);
    const start = beginResumeUpload.indexOf("if (!user) {");
    const end = beginResumeUpload.indexOf("}", beginResumeUpload.indexOf("return;", start));
    const guardLine = beginResumeUpload.slice(start, beginResumeUpload.indexOf("\n", start));
    // The condition itself must not reference the flag at all — enabling
    // local-AI cannot be a way back into a signed-out upload.
    assert.doesNotMatch(guardLine, /readLocalAiEnabled/);
    const branch = beginResumeUpload.slice(start, end + 1);
    assert.match(branch, /gate\(\{\s*kind:\s*"upload"/);
});

test("an entry point OTHER than the band — handleRankByFit's no-résumé fallback — passes through the SAME chokepoint, not a bare gate/importer call", () => {
    const start = SOURCE.indexOf("const handleRankByFit = async () => {");
    assert.ok(start !== -1, "handleRankByFit not found");
    const end = SOURCE.indexOf("};", start);
    const body = SOURCE.slice(start, end + 2);
    // Falls back to handleUploadClick (== beginResumeUpload, asserted
    // below), never opens the importer or the auth gate directly — so it
    // inherits beginResumeUpload's unconditional sign-in check by
    // construction instead of needing its own copy of the guard.
    assert.match(body, /handleUploadClick\(\);/);
    assert.doesNotMatch(body, /setImportOpen\(true\)/);
    assert.doesNotMatch(body, /gate\(\{/);
});

test("handleUploadClick is a bare pass-through to beginResumeUpload — not a second gate implementation", () => {
    const start = SOURCE.indexOf("const handleUploadClick = () => {");
    assert.ok(start !== -1);
    const end = SOURCE.indexOf("};", start);
    const body = SOURCE.slice(start, end + 2);
    assert.match(body, /const handleUploadClick = \(\) => \{\s*\n\s*beginResumeUpload\(\);\s*\n\s*\};/);
});

test("a second, independently-gated control (Apply) uses its OWN auth-gate reason, not \"fit\"", () => {
    // handleOpenPosting has no fixed sibling name to bound against, so slice
    // to the next top-level `const` declaration that follows it in source.
    const start = SOURCE.indexOf("const handleOpenPosting = (job: PublicJob) => {");
    assert.ok(start !== -1);
    const nextConstAfter = SOURCE.indexOf("\n    const ", start + 40);
    const body = SOURCE.slice(start, nextConstAfter);
    assert.match(body, /setAuthGateReason\("apply"\)/);
    assert.match(body, /gate\(\{\s*kind:\s*"apply"/);
    // Confirms this is genuinely a SEPARATE reason, not "fit" reused under a
    // different gate kind — the two controls must not be able to collide.
    assert.doesNotMatch(body, /setAuthGateReason\("fit"\)/);
});
