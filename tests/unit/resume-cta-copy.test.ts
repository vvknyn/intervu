import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CUSTOMIZE_READY_HEADER,
    FOR_YOU_DOWNLOAD_LABEL,
    FOR_YOU_UPLOAD_PDF_EMPTY,
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    JOBS_TAB_HELPER,
    RANK_SECONDARY_COPY,
    RESUME_UPLOAD_PROMISE,
    SIGN_IN_TO_SYNC_LABEL,
    UPLOAD_TO_CUSTOMIZE_LABEL,
    resumeUploadCtaLabel,
} from "../../src/lib/jobs/resume-cta-copy";
import { RESUME_UPLOAD_AUTH_CTA, RESUME_UPLOAD_CTA } from "../../src/lib/auth/auth-gate-copy";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "../../src/lib/marketing/public-copy";
import { connectTabLabel } from "../../src/components/layout/nav-tabs";

test("jobs tab helper copy matches contract", () => {
    assert.equal(
        JOBS_TAB_HELPER,
        "Search is open. Add a résumé to unlock fit bands and tailored applications.",
    );
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
        "Create a free account, upload one résumé, and unlock For you, fit bands, Customize, and tailored PDFs.",
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
        "Upload a PDF or Word résumé. We parse it privately, then show what was accepted before scoring jobs.",
    );
});

test("connectTabLabel switches on résumé presence", () => {
    assert.equal(connectTabLabel(false), "Add résumé");
    assert.equal(connectTabLabel(true), "Résumé & AI");
});

test("PUBLIC_ANTI_SCORE_SENTENCE matches contract", () => {
    assert.match(PUBLIC_ANTI_SCORE_SENTENCE, /No fake percentage/i);
    assert.match(PUBLIC_ANTI_SCORE_SENTENCE, /Strong\/Good\/Stretch/i);
});

test("resumeUploadCtaLabel switches on auth vs importer next step", () => {
    assert.equal(resumeUploadCtaLabel("auth"), RESUME_UPLOAD_AUTH_CTA);
    assert.equal(resumeUploadCtaLabel("importer"), RESUME_UPLOAD_CTA);
    assert.equal(resumeUploadCtaLabel("auth"), "Create account & upload résumé");
    assert.equal(resumeUploadCtaLabel("importer"), "Upload résumé");
});
