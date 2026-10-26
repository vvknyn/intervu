import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN,
    RESUME_UPLOAD_PROMISE,
    RESUME_UPLOAD_SIGNIN_LINE,
} from "../../src/lib/jobs/resume-cta-copy";

/**
 * Front-door redesign: the /jobs at-rest band (FrontDoorResumeBand.tsx) and
 * /resume's signed-out empty state share résumé CTA copy from resume-cta-copy.ts.
 */

test("RESUME_UPLOAD_PROMISE makes only the Local-mode claims, and no AI claim", () => {
    assert.doesNotMatch(RESUME_UPLOAD_PROMISE, /\bAI\b/);
    // The Local points (privacy-modes.ts): where the read happens, and what a search sends.
    assert.match(RESUME_UPLOAD_PROMISE, /we send the search only/);
});

test("RESUME_UPLOAD_SIGNIN_LINE makes no on-device/privacy/AI claim", () => {
    assert.doesNotMatch(RESUME_UPLOAD_SIGNIN_LINE, /on-device|on device|privacy|never leaves|\bAI\b/i);
    assert.equal(
        RESUME_UPLOAD_SIGNIN_LINE,
        "Sign in for every match. Saving your résumé to your account is a paid month.",
    );
});

test("FrontDoorResumeBand and /resume's signed-out empty state both import RESUME_UPLOAD_PROMISE from the shared module — not two hand-typed copies", () => {
    const band = readFileSync(
        join(__dirname, "../../src/components/jobs/front-door/FrontDoorResumeBand.tsx"),
        "utf8",
    );
    const resumePage = readFileSync(join(__dirname, "../../src/app/resume/page.tsx"), "utf8");
    // 4ac07706 moved the strings into privacy-modes.ts; resume-cta-copy re-exports them.
    const importsFromSharedModule = /from ["']@\/lib\/jobs\/resume-(cta|privacy)-copy["']/;
    assert.match(band, importsFromSharedModule);
    assert.match(band, /FRONT_DOOR_RESUME_CARD_SUBCOPY/);
    assert.match(resumePage, importsFromSharedModule);
    assert.match(resumePage, /RESUME_UPLOAD_PROMISE/);
});

test("FrontDoorResumeBand renders card subcopy, and the sign-in value line only when signed out", () => {
    const band = readFileSync(
        join(__dirname, "../../src/components/jobs/front-door/FrontDoorResumeBand.tsx"),
        "utf8",
    );
    // Signed-in accounts get their own subcopy and no sign-in line (the band replaced their onboarding card).
    assert.match(band, /\{signedIn \? FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN : FRONT_DOOR_RESUME_CARD_SUBCOPY\}/);
    assert.match(band, /\{!signedIn && \(\s*<p[^>]*>\s*\{RESUME_UPLOAD_SIGNIN_LINE\.split/);
    assert.match(band, /\{RESUME_UPLOAD_CTA\}/);
    assert.match(band, /<Button[^>]*variant="secondary"/, "the upload action is the Button primitive's secondary, not a raw button");
    assert.equal(
        FRONT_DOOR_RESUME_CARD_SUBCOPY,
        "Top 3 matches and why. Your résumé is read in your browser and stays on this device. The file is never uploaded.",
    );
    assert.equal(
        FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN,
        "Rank these jobs by fit. Local keeps your résumé on this device; Private cloud ($6 per 30 days) saves it to your account, encrypted.",
    );
});
