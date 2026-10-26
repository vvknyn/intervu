import { test } from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_EVENTS } from "../../src/lib/analytics/event-names";
import {
    buildResumeFunnelPayload,
    classifyResumeError,
    classifyResumeFileType,
} from "../../src/lib/analytics/resume-funnel";

test("ANALYTICS_EVENTS includes résumé funnel wire names", () => {
    assert.equal(ANALYTICS_EVENTS.resume_gate_shown, "resume_gate_shown");
    assert.equal(ANALYTICS_EVENTS.resume_upload_started, "resume_upload_started");
    assert.equal(ANALYTICS_EVENTS.resume_parse_succeeded, "resume_parse_succeeded");
    assert.equal(ANALYTICS_EVENTS.resume_review_completed, "resume_review_completed");
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

test("buildResumeFunnelPayload keeps file type and parser outcome, drops everything else", () => {
    const payload = buildResumeFunnelPayload({
        reason: "fit",
        file_type: "pdf",
        parser_source: "rules",
        duration_ms: 120,
        // Computed from the résumé's content or its fit: none may leave.
        size_bucket: "lt_100kb",
        section_count: 4,
        warning_count: 1,
        match_score: 91,
        skills: ["rust"],
        a_property_added_next_year: "x",
    } as Parameters<typeof buildResumeFunnelPayload>[0]);
    assert.deepEqual(payload, { reason: "fit", file_type: "pdf", parser_source: "rules", duration_ms: 120 });
});
