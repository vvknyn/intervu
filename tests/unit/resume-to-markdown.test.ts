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

test("a typed project round-trips into the markdown export", () => {
    const md = resumeDataToMarkdown(
        makeResume({
            sectionOrder: ["projects"],
            projects: [
                {
                    id: "p1",
                    company: "github.com/jane/chat-app",
                    role: "Real-time Chat App",
                    dates: "Fall 2024",
                    description: "• Built a WebSocket server handling 500 concurrent users",
                },
            ],
        }),
    );
    assert.match(md, /## Projects/);
    assert.match(md, /### Real-time Chat App — github\.com\/jane\/chat-app/);
    assert.match(md, /Fall 2024/);
    assert.match(md, /Built a WebSocket server handling 500 concurrent users/);
});

test("education renders honours when present, and no empty Honours label when absent", () => {
    const withHonours = resumeDataToMarkdown(
        makeResume({
            sectionOrder: ["education"],
            education: [
                {
                    id: "e1",
                    degree: "B.S. Computer Science",
                    institution: "State U",
                    year: "2026",
                    gpa: "3.8 / 4.0",
                    honours: ["Dean's List", "Magna Cum Laude"],
                    coursework: ["Data Structures", "Distributed Systems"],
                    activities: ["Robotics Club"],
                },
            ],
        }),
    );
    assert.match(withHonours, /GPA: 3\.8 \/ 4\.0/);
    assert.match(withHonours, /Honours: Dean's List, Magna Cum Laude/);
    assert.match(withHonours, /Relevant coursework: Data Structures, Distributed Systems/);
    assert.match(withHonours, /Activities: Robotics Club/);

    const withoutHonours = resumeDataToMarkdown(
        makeResume({
            sectionOrder: ["education"],
            education: [{ id: "e2", degree: "B.A. History", institution: "Other College", year: "2025" }],
        }),
    );
    assert.doesNotMatch(withoutHonours, /Honours:/);
    assert.doesNotMatch(withoutHonours, /GPA:/);
    assert.doesNotMatch(withoutHonours, /Relevant coursework:/);
    assert.doesNotMatch(withoutHonours, /Activities:/);
});
