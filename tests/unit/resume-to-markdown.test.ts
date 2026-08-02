import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeDataToMarkdown } from "../../src/lib/resume/to-markdown";
import type { ResumeData } from "../../src/types/resume";

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: { name: "Jane Doe", profession: "Engineer", yearsOfExperience: 5, location: "Remote", email: "", phone: "" },
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: "",
        ...overrides,
    };
}

test("renders the name as a heading and contact bits as a subline", () => {
    const md = resumeDataToMarkdown(makeResume());
    assert.match(md, /^# Jane Doe/);
    assert.match(md, /Engineer · Remote/);
});

test("omits a section entirely when it has no content, rather than printing a placeholder", () => {
    const md = resumeDataToMarkdown(makeResume({ generatedSummary: "" }));
    assert.doesNotMatch(md, /## Summary/);
    assert.doesNotMatch(md, /N\/A/i);
});

test("includes experience, skills, and education when present", () => {
    const md = resumeDataToMarkdown(
        makeResume({
            generatedSummary: "Builds things.",
            experience: [{ id: "1", company: "Acme", role: "SWE", dates: "2020–2024", description: "Shipped stuff." }],
            competencies: [{ category: "Languages", skills: ["TypeScript", "Go"] }],
            education: [{ id: "1", degree: "BS CS", institution: "State U", year: "2019" }],
        }),
    );
    assert.match(md, /## Summary[\s\S]*Builds things\./);
    assert.match(md, /### SWE — Acme/);
    assert.match(md, /\*\*Languages:\*\* TypeScript, Go/);
    assert.match(md, /BS CS — State U \(2019\)/);
});

test("respects a custom sectionOrder when present", () => {
    const md = resumeDataToMarkdown(
        makeResume({
            sectionOrder: ["education", "summary"],
            generatedSummary: "Summary text.",
            education: [{ id: "1", degree: "BS CS", institution: "State U" }],
        }),
    );
    const educationIndex = md.indexOf("## Education");
    const summaryIndex = md.indexOf("## Summary");
    assert.ok(educationIndex >= 0 && summaryIndex >= 0);
    assert.ok(educationIndex < summaryIndex, "education (listed first in sectionOrder) should render before summary");
});
