import { test } from "node:test";
import assert from "node:assert/strict";
import { fitTerms } from "../../src/lib/match/fit-terms";
import { scoreJobAgainstResume } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

const resume = {
    profile: { name: "Riley Chen", profession: "Registered Nurse", yearsOfExperience: 6, location: "Toronto, Ontario, Canada", email: "", phone: "", linkedin: "", website: "" },
    experience: [{ id: "e1", company: "Lakeview General", role: "Registered Nurse, Emergency", dates: "2019 - Present", description: "Triage and IV therapy on an ICU step-down unit." }],
    competencies: [{ category: "Skills", skills: ["Patient care", "Triage", "BLS"] }],
    education: [],
    generatedSummary: "",
} as unknown as ResumeData;

const job = { id: "j1", title: "Registered Nurse, Pediatrics - Per Diem", tags: ["ICU"], location: "Toronto, ON, Canada" } as unknown as PublicJob;

test("fitTerms splits the role's terms by the résumé, in the job's own casing, and adds up to the relevance count", () => {
    const terms = fitTerms(resume, job);
    assert.ok(terms);
    assert.ok(terms.matched.includes("Registered"));
    assert.ok(terms.matched.includes("Nurse"));
    assert.ok(terms.matched.includes("ICU"));
    assert.ok(terms.missing.includes("Pediatrics"));
    const relevance = scoreJobAgainstResume(resume, job)?.components.find((c) => c.key === "relevance");
    assert.ok(relevance?.terms);
    assert.equal(terms.matched.length, relevance.terms.matched);
    assert.equal(terms.matched.length + terms.missing.length, relevance.terms.of);
});

test("fitTerms is null when the role names no terms", () => {
    assert.equal(fitTerms(resume, { id: "j2", title: "", tags: [] } as unknown as PublicJob), null);
});
