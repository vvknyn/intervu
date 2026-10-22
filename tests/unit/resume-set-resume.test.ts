import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    validateResumeData,
    planResumeUpload,
    validateResumeUploadText,
    isBareDocumentId,
    planStructuredPersist,
} from "@/lib/resume/set-resume";
import { AGENT } from "@/lib/agent/config";
import type { BaseResume } from "@/lib/resume/base-resume";
import type { ResumeData } from "@/types/resume";

/** Mirrors resume-base-resume.test.ts's / resume-has-content.test.ts's
 *  blankResume() fixture — same shape, not a third hand-rolled copy. */
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

/* --------------------------------- validateResumeData --------------------------------- */
// The ONE strict ResumeData shape/cap check for agent-submitted resumes —
// pure, zero I/O, tested directly without touching Firestore.

describe("validateResumeData", () => {
    it("accepts a well-formed (even entirely blank) ResumeData shape", () => {
        const result = validateResumeData(blankResume());
        assert.equal(result.ok, true);
    });

    it("accepts a populated ResumeData with experience/competencies/education", () => {
        const data = blankResume({
            profile: { name: "Ada Lovelace", profession: "Software Engineer", yearsOfExperience: 8, location: "Remote", email: "ada@example.com", phone: "555-1234", linkedin: "linkedin.com/in/ada" },
            experience: [{ id: "exp-1", company: "Acme", role: "Senior Engineer", dates: "2020-Present", description: "Built things." }],
            competencies: [{ category: "Languages", skills: ["TypeScript", "Python"] }],
            education: [{ id: "edu-1", degree: "BSc CS", institution: "MIT", year: "2016" }],
            generatedSummary: "Experienced engineer.",
        });
        const result = validateResumeData(data);
        assert.equal(result.ok, true);
        assert.ok(result.ok && result.data.experience.length === 1);
    });

    it("rejects a non-object payload", () => {
        assert.equal(validateResumeData("just a string").ok, false);
        assert.equal(validateResumeData(null).ok, false);
        assert.equal(validateResumeData(42).ok, false);
    });

    it("rejects a payload missing a required top-level field (profile)", () => {
        const { profile, ...withoutProfile } = blankResume();
        void profile;
        const result = validateResumeData(withoutProfile);
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.issues.length > 0);
        assert.ok(!result.ok && result.issues.some((i) => i.path[0] === "profile"));
    });

    it("rejects a payload missing a required profile sub-field (email)", () => {
        const data = blankResume();
        // @ts-expect-error deliberately malformed for the test
        delete data.profile.email;
        const result = validateResumeData(data);
        assert.equal(result.ok, false);
        assert.ok(!result.ok && result.issues.some((i) => i.path.join(".") === "profile.email"));
    });

    it("rejects an experience description longer than RESUME_DATA_FIELD_MAX_CHARS", () => {
        assert.equal(AGENT.RESUME_DATA_FIELD_MAX_CHARS, 5_000);
        const data = blankResume({
            experience: [{ id: "e1", company: "Acme", role: "Eng", dates: "2020", description: "x".repeat(AGENT.RESUME_DATA_FIELD_MAX_CHARS + 1) }],
        });
        assert.equal(validateResumeData(data).ok, false);
    });

    it("accepts an experience description right at RESUME_DATA_FIELD_MAX_CHARS", () => {
        const data = blankResume({
            experience: [{ id: "e1", company: "Acme", role: "Eng", dates: "2020", description: "x".repeat(AGENT.RESUME_DATA_FIELD_MAX_CHARS) }],
        });
        assert.equal(validateResumeData(data).ok, true);
    });

    it("rejects more than RESUME_DATA_ARRAY_MAX_ITEMS experience entries", () => {
        assert.equal(AGENT.RESUME_DATA_ARRAY_MAX_ITEMS, 50);
        const many = Array.from({ length: 51 }, (_, i) => ({ id: `e${i}`, company: "Acme", role: "Eng", dates: "2020", description: "" }));
        const data = blankResume({ experience: many });
        assert.equal(validateResumeData(data).ok, false);
    });

    it("the SAME array cap applies to competencies' skills list too — class-wide, not an experience-only special case", () => {
        const manySkills = Array.from({ length: 51 }, (_, i) => `skill-${i}`);
        const data = blankResume({ competencies: [{ category: "Languages", skills: manySkills }] });
        assert.equal(validateResumeData(data).ok, false);
    });

    it("rejects yearsOfExperience outside the sane range", () => {
        assert.equal(validateResumeData(blankResume({ profile: { ...blankResume().profile, yearsOfExperience: -1 } })).ok, false);
        assert.equal(validateResumeData(blankResume({ profile: { ...blankResume().profile, yearsOfExperience: 1.5 } })).ok, false);
    });

    it("issues report a compact path+message per problem, never a raw ZodError", () => {
        const result = validateResumeData({ profile: { name: "x" } });
        assert.equal(result.ok, false);
        assert.ok(!result.ok);
        if (!result.ok) {
            for (const issue of result.issues) {
                assert.equal(typeof issue.message, "string");
                assert.ok(Array.isArray(issue.path));
            }
        }
    });
});

/* --------------------------------- planResumeUpload --------------------------------- */
// Every set_resume decision (baseline guard, history append, validate-or-
// clear resume_data, the returned result) — pure, zero I/O.

const RESUME_TEXT_PRIOR: BaseResume = { source: "resume_text", resume_text: "Old plain-text resume" };
const RESUME_DATA_PRIOR: BaseResume = { source: "resume_data", resume_data: blankResume({ generatedSummary: "Old structured resume" }) };
const NONE_PRIOR: BaseResume = { source: "none" };

describe("planResumeUpload — first-call baseline guard", () => {
    it("fires when a resume already exists AND history is empty", () => {
        const plan = planResumeUpload(RESUME_TEXT_PRIOR, true, { text: "New resume text" }, "2026-08-03T00:00:00.000Z");
        assert.ok(plan.baselineEntry);
        assert.equal(plan.baselineEntry?.label, "pre-chat-upload baseline");
        assert.equal(plan.baselineEntry?.content, "Old plain-text resume");
    });

    it("does NOT fire a second time once history already has an entry — proves it can only ever fire once", () => {
        const plan = planResumeUpload(RESUME_TEXT_PRIOR, false, { text: "Another upload" }, "2026-08-04T00:00:00.000Z");
        assert.equal(plan.baselineEntry, null);
    });

    it("does not fire when there was no prior resume at all, even with empty history — nothing to snapshot", () => {
        const plan = planResumeUpload(NONE_PRIOR, true, { text: "First-ever resume" }, "2026-08-03T00:00:00.000Z");
        assert.equal(plan.baselineEntry, null);
    });

    it("a structured (resume_data) prior resume gets a faithful (JSON) baseline content, not a fabricated placeholder", () => {
        const plan = planResumeUpload(RESUME_DATA_PRIOR, true, { text: "New text" }, "2026-08-03T00:00:00.000Z");
        assert.ok(plan.baselineEntry);
        assert.deepEqual(JSON.parse(plan.baselineEntry!.content), RESUME_DATA_PRIOR.source === "resume_data" ? RESUME_DATA_PRIOR.resume_data : undefined);
    });
});

describe("planResumeUpload — history accumulates", () => {
    it("always produces a fresh history entry for THIS upload, distinct call to call", () => {
        const first = planResumeUpload(NONE_PRIOR, true, { text: "v1", label: "first" }, "2026-08-01T00:00:00.000Z");
        const second = planResumeUpload(RESUME_TEXT_PRIOR, false, { text: "v2", label: "second" }, "2026-08-02T00:00:00.000Z");
        assert.deepEqual(first.historyEntry, { content: "v1", label: "first", saved_at: "2026-08-01T00:00:00.000Z" });
        assert.deepEqual(second.historyEntry, { content: "v2", label: "second", saved_at: "2026-08-02T00:00:00.000Z" });
        assert.notDeepEqual(first.historyEntry, second.historyEntry);
    });

    it("defaults the label to \"chat upload\" when omitted or blank", () => {
        assert.equal(planResumeUpload(NONE_PRIOR, true, { text: "v1" }).historyEntry.label, "chat upload");
        assert.equal(planResumeUpload(NONE_PRIOR, true, { text: "v1", label: "   " }).historyEntry.label, "chat upload");
    });

    it("uses a caller-supplied label as-is, trimmed", () => {
        assert.equal(planResumeUpload(NONE_PRIOR, true, { text: "v1", label: "  tailored for Acme  " }).historyEntry.label, "tailored for Acme");
    });
});

describe("planResumeUpload — newest state wins", () => {
    it("valid new resume_data supersedes a prior resume_data entirely", () => {
        const newData = blankResume({ generatedSummary: "Brand new structured resume" });
        const plan = planResumeUpload(RESUME_DATA_PRIOR, false, { text: "new plain text", data: newData });
        assert.deepEqual(plan.profileWrite.resume_data, newData);
        assert.equal(plan.result.source, "resume_data");
        assert.ok(plan.result.source === "resume_data" && plan.result.resume_data.generatedSummary === "Brand new structured resume");
        assert.equal(plan.result.normalized, true);
    });

    it("a text-only call clears a PRE-EXISTING resume_data rather than leaving it stale (the reason resume_data is deleted, not skipped)", () => {
        const plan = planResumeUpload(RESUME_DATA_PRIOR, false, { text: "just plain text this time" });
        assert.equal(plan.profileWrite.resume_data, null);
        assert.equal(plan.result.source, "resume_text");
        assert.ok(plan.result.source === "resume_text" && plan.result.resume_text === "just plain text this time");
        assert.equal(plan.result.normalized, false);
        assert.equal("issues" in plan.result, false);
    });

    it("resume_text is always written from THIS call's input, never merged with the prior text", () => {
        const plan = planResumeUpload(RESUME_TEXT_PRIOR, false, { text: "completely different text" });
        assert.equal(plan.profileWrite.resume_text, "completely different text");
    });
});

describe("planResumeUpload — invalid resume_data never rejects the whole call", () => {
    it("text is still stored, normalized:false, non-empty issues reported", () => {
        const plan = planResumeUpload(NONE_PRIOR, true, { text: "My resume text", data: { garbage: true } });
        assert.equal(plan.profileWrite.resume_text, "My resume text");
        assert.equal(plan.result.normalized, false);
        assert.ok(plan.result.issues && plan.result.issues.length > 0);
    });

    it("resume_data is cleared (null), never left as the stale prior value", () => {
        const plan = planResumeUpload(RESUME_DATA_PRIOR, false, { text: "new text", data: { garbage: true } });
        assert.equal(plan.profileWrite.resume_data, null);
        assert.equal(plan.result.source, "resume_text");
    });

    it("an absent resume_data (never attempted) is normalized:false with NO issues — distinct from an attempted-and-failed validation", () => {
        const plan = planResumeUpload(NONE_PRIOR, true, { text: "text only, no data field at all" });
        assert.equal(plan.result.normalized, false);
        assert.equal("issues" in plan.result, false);
    });
});

/* --------------------------------- validateResumeUploadText --------------------------------- */
// R1 (2026-08-09 user report): the account "Resume" section's upload/
// replace action's own validation, reusing AGENT.RESUME_TEXT_MAX_CHARS —
// the SAME cap the MCP set_resume tool's wire schema (route.ts's
// setResumeInput) enforces.

describe("validateResumeUploadText", () => {
    it("rejects empty text", () => {
        const result = validateResumeUploadText("");
        assert.equal(result.ok, false);
    });

    it("rejects whitespace-only text — nothing real came through", () => {
        const result = validateResumeUploadText("   \n\t  ");
        assert.equal(result.ok, false);
    });

    it("rejects text longer than RESUME_TEXT_MAX_CHARS", () => {
        const result = validateResumeUploadText("x".repeat(AGENT.RESUME_TEXT_MAX_CHARS + 1));
        assert.equal(result.ok, false);
    });

    it("accepts text right at RESUME_TEXT_MAX_CHARS", () => {
        const result = validateResumeUploadText("x".repeat(AGENT.RESUME_TEXT_MAX_CHARS));
        assert.equal(result.ok, true);
    });

    it("accepts ordinary resume text and trims surrounding whitespace", () => {
        const result = validateResumeUploadText("  My resume content here.  ");
        assert.ok(result.ok);
        assert.ok(result.ok && result.text === "My resume content here.");
    });

    it("a too-long error message states the real cap, not a hand-copied number that can drift", () => {
        const result = validateResumeUploadText("x".repeat(AGENT.RESUME_TEXT_MAX_CHARS + 1));
        assert.ok(!result.ok && result.error.includes(AGENT.RESUME_TEXT_MAX_CHARS.toLocaleString()));
    });
});

describe("clearBaseResumeForUser", () => {
    it("deletes every resume_history document, then the profile résumé fields", () => {
        const src = readFileSync(join(__dirname, "../../src/lib/resume/set-resume.ts"), "utf8");
        const start = src.indexOf("export async function clearBaseResumeForUser");
        const end = src.indexOf("export type ResumeUploadTextValidation");
        assert.ok(start >= 0 && end > start);
        const fn = src.slice(start, end);
        assert.match(fn, /deleteResumeHistoryForUser\(uid\)/);
        assert.match(fn, /resume_text: FieldValue\.delete\(\)/);
        assert.match(fn, /resume_data: FieldValue\.delete\(\)/);
        const helperStart = src.indexOf("async function deleteResumeHistoryForUser");
        const helper = src.slice(helperStart, start);
        assert.match(helper, /collection\("resume_history"\)/);
        assert.match(helper, /batch\.delete\(doc\.ref\)/);
        assert.doesNotMatch(fn + helper, /Never touches/);
    });
});

describe("saveResumeData", () => {
    it("drops resume_text when resume_data saves, and still writes resume_text on the text-only fallback", () => {
        const src = readFileSync(join(__dirname, "../../src/actions/resume.ts"), "utf8");
        const start = src.indexOf("export async function saveResumeData");
        const end = src.indexOf("function resumeDataToText");
        assert.ok(start >= 0 && end > start);
        const fn = src.slice(start, end);
        const successAt = fn.indexOf("resume_text: FieldValue.delete()");
        const fallbackAt = fn.indexOf("resume_text: resumeDataToText(");
        assert.ok(successAt >= 0, "successful structured save must delete resume_text");
        assert.ok(fallbackAt > successAt, "text-only fallback must still store resume_text");
        assert.match(fn, /\.set\(updateData, \{ merge: true \}\)/);
        // 2026-10-13: the fallback must also drop the OLDER structured copy, or every read
        // (`fetchResumeData` prefers resume_data) keeps returning the previous résumé.
        assert.ok(fn.indexOf("resume_data: FieldValue.delete()", fallbackAt) > fallbackAt, "text-only fallback must remove the stale resume_data");
        assert.match(fn.slice(fallbackAt), /resume_last_updated: savedAt/);
    });
});

describe("isBareDocumentId()", () => {
    // The uid in the path already confines a caller to their own history.
    // This closes the one remaining way out: Firestore reads a slash in
    // `.doc()` as a path separator, so an id carrying one would address a
    // document outside the subcollection the delete is scoped to.
    it("accepts the ids Firestore actually generates", () => {
        for (const id of ["aBcD1234", "x", "A1_b-2", "kJ8sh2Ksh2mLq0PqR3zZ"]) {
            assert.ok(isBareDocumentId(id), `${id} should be accepted`);
        }
    });

    it("rejects anything that could walk out of the subcollection", () => {
        for (const id of [
            "",
            "a/b",
            "../profiles",
            "x/resume_history/y",
            "profiles/other-uid",
            "a b",
            "a.b",
            "..",
        ]) {
            assert.equal(isBareDocumentId(id), false, `${id} should be rejected`);
        }
    });
});

describe("planStructuredPersist", () => {
    const nurse = blankResume({ generatedSummary: "Nurse, 4 years.", profile: { name: "A", profession: "Nurse", yearsOfExperience: 4, location: "", email: "", phone: "" } });
    const dev = blankResume({ generatedSummary: "Dev, 8 years." });

    it("persists a valid structured copy when the server holds only text", () => {
        const plan = planStructuredPersist({ text: "raw" }, nurse);
        assert.ok(plan.persist && plan.data.profile.profession === "Nurse");
        assert.equal(planStructuredPersist({ data: blankResume(), text: "raw" }, dev).persist, true);
    });
    it("never overwrites structured content the server already has", () => {
        assert.deepEqual(planStructuredPersist({ data: nurse, text: "raw" }, dev), { persist: false, reason: "has-structured" });
    });
    it("persists nothing when there is no stored text", () => {
        assert.deepEqual(planStructuredPersist({}, nurse), { persist: false, reason: "no-text" });
    });
    it("rejects a payload that fails validation", () => {
        assert.deepEqual(planStructuredPersist({ text: "raw" }, { experience: "nope" }), { persist: false, reason: "invalid" });
        assert.deepEqual(planStructuredPersist({ text: "raw" }, null), { persist: false, reason: "invalid" });
    });
});
