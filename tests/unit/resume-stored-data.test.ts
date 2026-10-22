import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storedResumeData, shouldPersistStructured } from "../../src/lib/resume/stored-resume-data";
import { resumeIsUsable } from "../../src/lib/resume/resume-usable";
import type { ResumeData } from "../../src/types/resume";

const TEXT = `Jane Doe
Senior Software Engineer
Toronto, ON | jane@example.com | (416) 555-0100

SUMMARY
Backend engineer with 8 years building payments systems in Go and TypeScript.

EXPERIENCE
Senior Software Engineer | Stripe | 2021 – Present
• Led the ledger migration to Postgres

SKILLS
Go, TypeScript, PostgreSQL

EDUCATION
BSc Computer Science | University of Waterloo | 2016`;

const STRUCTURED: ResumeData = {
    profile: { name: "Ada", profession: "Nurse", yearsOfExperience: 4, location: "Boston, MA", email: "", phone: "" },
    generatedSummary: "",
    competencies: [],
    experience: [],
    education: [],
};

describe("storedResumeData", () => {
    it("structures a text-only résumé so matching can use it", () => {
        const data = storedResumeData(undefined, TEXT);
        assert.ok(data);
        assert.equal(data.profile.name, "Jane Doe");
        assert.equal(data.profile.profession, "Senior Software Engineer");
        assert.ok(resumeIsUsable(data), "a text upload must rank jobs like a structured import");
    });

    it("keeps structured data when it has content, whatever text sits beside it", () => {
        assert.equal(storedResumeData(STRUCTURED, TEXT), STRUCTURED);
    });

    it("falls back to the text when the structured copy is empty", () => {
        const empty: ResumeData = { ...STRUCTURED, profile: { ...STRUCTURED.profile, profession: "" } };
        assert.equal(storedResumeData(empty, TEXT)?.profile.profession, "Senior Software Engineer");
    });

    it("returns nothing when there is neither", () => {
        assert.equal(storedResumeData(undefined, undefined), undefined);
        assert.equal(storedResumeData(undefined, "   "), undefined);
        assert.equal(storedResumeData(undefined, 42), undefined);
    });
});

describe("shouldPersistStructured", () => {
    const structured = storedResumeData(undefined, TEXT);
    const base = { signedIn: true, serverData: undefined, serverText: TEXT, structured };

    it("persists a signed-in, text-only résumé that structured into something usable", () => {
        assert.equal(shouldPersistStructured(base), true);
    });
    it("does not persist when the server already has structured content", () => {
        assert.equal(shouldPersistStructured({ ...base, serverData: STRUCTURED }), false);
    });
    it("does not persist for a guest", () => {
        assert.equal(shouldPersistStructured({ ...base, signedIn: false }), false);
    });
    it("does not persist when the server sent no text", () => {
        assert.equal(shouldPersistStructured({ ...base, serverText: "  " }), false);
        assert.equal(shouldPersistStructured({ ...base, serverText: undefined }), false);
    });
    it("does not persist when structuring failed or came out unusable", () => {
        assert.equal(shouldPersistStructured({ ...base, structured: undefined }), false);
        assert.equal(shouldPersistStructured({ ...base, structured: { ...STRUCTURED, profile: { ...STRUCTURED.profile, profession: "" } } }), false);
    });
});
