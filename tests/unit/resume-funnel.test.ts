import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_EVENTS } from "../../src/lib/analytics/event-names";
import {
    buildResumeFunnelPayload,
    classifyResumeError,
    classifyResumeFileType,
    classifyResumeSizeBucket,
} from "../../src/lib/analytics/resume-funnel";

test("ANALYTICS_EVENTS includes résumé funnel wire names", () => {
    assert.equal(ANALYTICS_EVENTS.resume_gate_shown, "resume_gate_shown");
    assert.equal(ANALYTICS_EVENTS.resume_upload_started, "resume_upload_started");
    assert.equal(ANALYTICS_EVENTS.resume_parse_succeeded, "resume_parse_succeeded");
    assert.equal(ANALYTICS_EVENTS.resume_review_completed, "resume_review_completed");
});

test("classifyResumeSizeBucket buckets byte sizes", () => {
    assert.equal(classifyResumeSizeBucket(0), "empty");
    assert.equal(classifyResumeSizeBucket(50_000), "lt_100kb");
    assert.equal(classifyResumeSizeBucket(500_000), "100kb_1mb");
    assert.equal(classifyResumeSizeBucket(2_000_000), "1mb_5mb");
    assert.equal(classifyResumeSizeBucket(6_000_000), "gt_5mb");
});

test("classifyResumeFileType classifies extension tokens only", () => {
    assert.equal(classifyResumeFileType("pdf"), "pdf");
    assert.equal(classifyResumeFileType("docx"), "docx");
    assert.equal(classifyResumeFileType("txt"), "other");
});

test("classifyResumeError returns stable codes", () => {
    assert.equal(classifyResumeError({ message: "Unsupported file type" }), "unsupported");
    assert.equal(classifyResumeError({ byteLength: 0 }), "empty");
});

test("buildResumeFunnelPayload strips sensitive keys", () => {
    const payload = buildResumeFunnelPayload({
        reason: "fit",
        file_type: "pdf",
        filename: "secret.pdf",
        email: "user@example.com",
        raw_error: "stack trace",
        file_contents: "John Doe",
        resume_text: "experience",
    });
    assert.equal(payload.reason, "fit");
    assert.equal(payload.file_type, "pdf");
    assert.equal((payload as Record<string, unknown>).filename, undefined);
    assert.equal((payload as Record<string, unknown>).email, undefined);
    assert.equal((payload as Record<string, unknown>).raw_error, undefined);
    assert.equal((payload as Record<string, unknown>).file_contents, undefined);
});
