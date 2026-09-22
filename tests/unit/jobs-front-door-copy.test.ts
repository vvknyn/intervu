import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    RESUME_UPLOAD_PROMISE,
    RESUME_UPLOAD_SIGNIN_LINE,
} from "../../src/lib/jobs/resume-cta-copy";

/**
 * Front-door redesign: the /jobs at-rest band (FrontDoorResumeBand.tsx) and
 * /resume's signed-out empty state share résumé CTA copy from resume-cta-copy.ts.
 */

test("RESUME_UPLOAD_PROMISE makes no on-device/privacy/AI claim beyond parse privacy", () => {
    assert.doesNotMatch(RESUME_UPLOAD_PROMISE, /on-device|on device|\bAI\b/i);
    assert.match(RESUME_UPLOAD_PROMISE, /parse it privately/i);
});

test("RESUME_UPLOAD_SIGNIN_LINE makes no on-device/privacy/AI claim", () => {
    assert.doesNotMatch(RESUME_UPLOAD_SIGNIN_LINE, /on-device|on device|privacy|never leaves|\bAI\b/i);
    assert.equal(
        RESUME_UPLOAD_SIGNIN_LINE,
        "Sign in to sync your résumé and tracker across devices.",
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
    assert.match(band, /FRONT_DOOR_RESUME_CARD_SUBCOPY/);
    assert.match(resumePage, importsFromSharedModule);
    assert.match(resumePage, /RESUME_UPLOAD_PROMISE/);
});

test("FrontDoorResumeBand renders card subcopy and the sign-in value line", () => {
    const band = readFileSync(
        join(__dirname, "../../src/components/jobs/front-door/FrontDoorResumeBand.tsx"),
        "utf8",
    );
    assert.match(band, /\{FRONT_DOOR_RESUME_CARD_SUBCOPY\}/);
    assert.match(band, /RESUME_UPLOAD_SIGNIN_LINE\.split/);
    assert.equal(
        FRONT_DOOR_RESUME_CARD_SUBCOPY,
        "Create a free account, upload one résumé, and unlock For you, fit bands, Customize, and tailored PDFs.",
    );
});
