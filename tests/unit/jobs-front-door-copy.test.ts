import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESUME_UPLOAD_PROMISE, RESUME_UPLOAD_SIGNIN_LINE } from "../../src/lib/jobs/resume-cta-copy";

/**
 * Front-door redesign, mid-task correction: the /jobs at-rest band
 * (FrontDoorResumeBand.tsx) and /resume's signed-out empty state must state
 * the SAME thing about what uploading does, or the two surfaces drift —
 * `resume-cta-copy.ts` is the single source both read from. Also guards the
 * correction itself: no AI/privacy/on-device claim anywhere, since the
 * default upload path is server-side (see that module's doc comment).
 */

test("RESUME_UPLOAD_PROMISE makes no on-device/privacy/AI claim", () => {
    assert.doesNotMatch(RESUME_UPLOAD_PROMISE, /on-device|on device|privacy|never leaves|\bAI\b/i);
    assert.equal(RESUME_UPLOAD_PROMISE, "Upload a PDF or Word document.");
});

test("RESUME_UPLOAD_SIGNIN_LINE makes no on-device/privacy/AI claim", () => {
    assert.doesNotMatch(RESUME_UPLOAD_SIGNIN_LINE, /on-device|on device|privacy|never leaves|\bAI\b/i);
    assert.equal(
        RESUME_UPLOAD_SIGNIN_LINE,
        "Sign in to upload. You also get job alerts, saved searches, and an application tracker on any device.",
    );
});

test("FrontDoorResumeBand and /resume's signed-out empty state both import RESUME_UPLOAD_PROMISE from the shared module — not two hand-typed copies", () => {
    const band = readFileSync(
        join(__dirname, "../../src/components/jobs/front-door/FrontDoorResumeBand.tsx"),
        "utf8",
    );
    const resumePage = readFileSync(join(__dirname, "../../src/app/resume/page.tsx"), "utf8");
    const importsFromSharedModule = /from ["']@\/lib\/jobs\/resume-cta-copy["']/;
    assert.match(band, importsFromSharedModule);
    assert.match(band, /RESUME_UPLOAD_PROMISE/);
    assert.match(resumePage, importsFromSharedModule);
    assert.match(resumePage, /RESUME_UPLOAD_PROMISE/);
});

test("FrontDoorResumeBand renders both the promise and the sign-in value line", () => {
    const band = readFileSync(
        join(__dirname, "../../src/components/jobs/front-door/FrontDoorResumeBand.tsx"),
        "utf8",
    );
    assert.match(band, /\{RESUME_UPLOAD_PROMISE\}/);
    assert.match(band, /\{RESUME_UPLOAD_SIGNIN_LINE\}/);
});
