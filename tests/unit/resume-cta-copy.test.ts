import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CUSTOMIZE_READY_HEADER,
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    JOBS_TAB_HELPER,
    POST_SIGNUP_RESUME_GATE_TITLE,
    RANK_SECONDARY_COPY,
    RESUME_UPLOAD_PROMISE,
    SIGN_IN_TO_SYNC_LABEL,
    UPLOAD_TO_CUSTOMIZE_LABEL,
    jobsTabHelperCopy,
} from "../../src/lib/jobs/resume-cta-copy";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "../../src/lib/marketing/public-copy";
import { connectTabLabel } from "../../src/components/layout/nav-tabs";

test("jobs tab helper copy matches contract", () => {
    assert.equal(
        JOBS_TAB_HELPER,
        "Search is open. Add a résumé to unlock fit bands and tailored applications.",
    );
});

test("jobsTabHelperCopy shows Add-résumé helper only when résumé is confirmed absent", () => {
    assert.equal(jobsTabHelperCopy(false), JOBS_TAB_HELPER);
    assert.equal(jobsTabHelperCopy(true), null);
    assert.notEqual(jobsTabHelperCopy(true), JOBS_TAB_HELPER);
    assert.equal(jobsTabHelperCopy(null), null);
});

test("jobs page imports shared résumé CTA copy and tracks resumeOnFile", () => {
    const pageSrc = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");
    assert.match(pageSrc, /from "@\/lib\/jobs\/resume-cta-copy"/);
    assert.match(pageSrc, /RESUME_UPLOAD_PROMISE/);
    assert.match(pageSrc, /\bresumeOnFile\b/);
});

test("inline Search button takes the control corner from the Button face, not its own", () => {
    const pageSrc = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");
    const searchButtonBlock =
        pageSrc.match(
            /onClick=\{\(\) => submitSearch\(queryDraft\)\}[\s\S]*?<\/Button>/,
        )?.[0] ?? "";
    assert.ok(searchButtonBlock.length > 0, "inline Search button block not found");
    // Was rounded-pill; since 2026-09-29 a button's corner (and type) come from
    // `.ctl-button` (tests/unit/control-type.test.ts), so it names none.
    assert.doesNotMatch(searchButtonBlock, /\brounded(?:-[\w-]+)?\b/);
});

test("rank secondary copy matches contract", () => {
    assert.equal(
        RANK_SECONDARY_COPY,
        "See Strong, Good, and Stretch matches—with the reasons.",
    );
});

test("front door card subcopy matches contract", () => {
    assert.equal(
        FRONT_DOOR_RESUME_CARD_SUBCOPY,
        // 4ac07706 (signed-out résumé privacy claims) added "It stays in this browser".
        "Upload one résumé to see your top 3 matches and why. It stays in this browser; a free account unlocks every match, customize, and tailored PDFs.",
    );
});

test("for-you download and empty-state copy match contract", () => {
    assert.equal(FOR_YOU_DOWNLOAD_LABEL, "Download tailored PDF & open application");
    assert.equal(FOR_YOU_UPLOAD_PDF_EMPTY, "Upload résumé to create a tailored PDF.");
});

test("customize panel copy matches contract", () => {
    assert.equal(CUSTOMIZE_READY_HEADER, "Your résumé is ready. Customize for this role.");
    assert.equal(SIGN_IN_TO_SYNC_LABEL, "Sign in to sync this version.");
    assert.equal(UPLOAD_TO_CUSTOMIZE_LABEL, "Upload résumé to customize.");
});

test("resume upload promise matches contract", () => {
    assert.equal(
        RESUME_UPLOAD_PROMISE,
        "Upload a PDF or Word résumé. We parse it in your browser, show what we accepted, then use derived role and skill phrases to retrieve matching jobs—not your full file. Fit labels are computed after results return.",
    );
});

test("post-signup résumé gate title matches contract", () => {
    assert.equal(POST_SIGNUP_RESUME_GATE_TITLE, "Upload your résumé");
    assert.doesNotMatch(POST_SIGNUP_RESUME_GATE_TITLE, /jungle|rails|packet/i);
});

test("connectTabLabel switches on résumé presence", () => {
    assert.equal(connectTabLabel(false), "Add résumé");
    assert.equal(connectTabLabel(true), "Résumé & AI");
});

test("PUBLIC_ANTI_SCORE_SENTENCE matches contract", () => {
    assert.match(PUBLIC_ANTI_SCORE_SENTENCE, /No fake percentage/i);
    assert.match(PUBLIC_ANTI_SCORE_SENTENCE, /Strong\/Good\/Stretch/i);
});
