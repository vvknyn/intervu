import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { zipMarkdownToHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

const CSM_GOLDEN = readFileSync(
    path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"),
    "utf8",
);

function goldenResumeData(): ResumeData {
    const draft = structureResumeText(CSM_GOLDEN);
    return {
        profile: {
            name: draft.profile.name ?? "",
            profession: draft.profile.profession ?? "",
            yearsOfExperience: draft.profile.yearsOfExperience ?? 0,
            location: draft.profile.location ?? "",
            email: draft.profile.email ?? "",
            phone: draft.profile.phone ?? "",
            linkedin: draft.profile.linkedin,
            website: draft.profile.website,
        },
        experience: draft.experience.map((e, i) => ({ ...e, id: `exp-${i}` })),
        projects: draft.projects.map((e, i) => ({ ...e, id: `proj-${i}` })),
        competencies: draft.competencies,
        education: draft.education.map((e, i) => ({ ...e, id: `edu-${i}` })),
        generatedSummary: draft.generatedSummary,
    };
}

describe("zipMarkdownToHtml", () => {
    it("golden CSM HTML matches zip visual system", () => {
        const html = zipMarkdownToHtml(resumeDataToZipMarkdown(goldenResumeData()));

        assert.match(html, /Vivek Narayanan/);
        assert.match(html, /Richmond Hill, Ontario/);
        assert.match(html, /PROFESSIONAL SUMMARY/);
        assert.match(html, /CORE COMPETENCIES/);
        assert.match(html, /PROFESSIONAL EXPERIENCE/);
        assert.match(html, /EDUCATION &amp; PROFESSIONAL DEVELOPMENT|EDUCATION & PROFESSIONAL DEVELOPMENT/);

        assert.match(html, /<strong>Customer Success &amp; Account Management:<\/strong>/);
        assert.match(html, /resume-entry-title[^<]*Client-facing Product Manager \| TELUS Health Wellbeing/);
        assert.match(html, /resume-entry-dates[^<]*September 2021 — Present/);

        assert.match(html, /@page\s*\{\s*size:\s*letter/);
        assert.match(html, /resume-bullets li::before/);
        assert.match(html, /border-radius:\s*50%/);

        assert.doesNotMatch(html, /\.resume-paragraph\s*\{[^}]*letter-spacing/);
        assert.doesNotMatch(html, /\.resume-bullets li\s*\{[^}]*letter-spacing/);
        assert.ok(!/Hands-on with/i.test(html));
    });
});
