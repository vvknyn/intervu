import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canonicalizeBaseResume } from "@/lib/resume/base-resume";
import type { ResumeData } from "@/types/resume";

/** Mirrors resume-has-content.test.ts's blankResume() fixture. */
function blankResume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: {
            name: "",
            profession: "",
            yearsOfExperience: 0,
            location: "",
            email: "",
            phone: "",
        },
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: "",
        ...overrides,
    };
}

describe("canonicalizeBaseResume", () => {
    it("picks resume_data as canonical when it has real content", () => {
        const data = blankResume({ generatedSummary: "Senior engineer with 10 years..." });
        const out = canonicalizeBaseResume(data, "some plain text resume too");
        assert.deepEqual(out, { source: "resume_data", resume_data: data });
    });

    it("falls back to resume_text when resume_data has no real content", () => {
        const out = canonicalizeBaseResume(blankResume(), "Plain text resume body");
        assert.deepEqual(out, { source: "resume_text", resume_text: "Plain text resume body" });
    });

    it("falls back to resume_text when resume_data is entirely absent", () => {
        const out = canonicalizeBaseResume(undefined, "Plain text resume body");
        assert.deepEqual(out, { source: "resume_text", resume_text: "Plain text resume body" });
    });

    it("trims resume_text before returning it", () => {
        const out = canonicalizeBaseResume(undefined, "  Plain text resume body  \n");
        assert.deepEqual(out, { source: "resume_text", resume_text: "Plain text resume body" });
    });

    it("empty state: neither resume_data nor resume_text present returns an explicit none, never a placeholder", () => {
        assert.deepEqual(canonicalizeBaseResume(undefined, undefined), { source: "none" });
    });

    it("empty state: blank resume_data and whitespace-only resume_text also resolve to none", () => {
        assert.deepEqual(canonicalizeBaseResume(blankResume(), "   \n\t  "), { source: "none" });
    });

    it("never fabricates content: an empty resume_data is not treated as canonical even when present", () => {
        // resume_data being *present* (an object exists on the profile doc) is
        // not enough — hasResumeContent decides, so a builder session that
        // never got past a blank form doesn't shadow a real resume_text.
        const out = canonicalizeBaseResume(blankResume(), "Real resume content here");
        assert.equal(out.source, "resume_text");
    });
});
