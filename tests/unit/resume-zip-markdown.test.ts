import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseResumeContent } from "@/lib/resume/parse-resume-content";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
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

describe("resumeDataToZipMarkdown", () => {
    it("golden CSM fixture produces zip-shaped markdown", () => {
        const md = resumeDataToZipMarkdown(goldenResumeData());

        assert.match(md, /^# Vivek Narayanan/m);
        assert.match(md, /Richmond Hill, Ontario \|/);
        assert.match(md, /viveknyan@gmail\.com/);
        assert.match(md, /linkedin\.com\/in\/viveknar/);

        assert.match(md, /## PROFESSIONAL SUMMARY/);
        assert.match(md, /## CORE COMPETENCIES/);
        assert.match(md, /## PROFESSIONAL EXPERIENCE/);
        assert.match(md, /## EDUCATION & PROFESSIONAL DEVELOPMENT/);
        assert.doesNotMatch(md, /## INDEPENDENT PROJECTS/);

        assert.match(md, /\*\*Customer Success & Account Management:\*\*/);
        assert.match(md, /\*\*Delivery & Process Excellence:\*\*/);
        assert.match(md, /\*\*Platforms & Tools:\*\*/);
        assert.doesNotMatch(md, /\*\*Skills:\*\*/);

        assert.match(md, /### Client-facing Product Manager \| TELUS Health Wellbeing/);
        assert.match(md, /September 2021 — Present/);

        assert.match(md, /University at Buffalo/);
        assert.doesNotMatch(md, /University \| Buffalo/);
        assert.ok(!/Hands-on with/i.test(md));
    });

    it("round-trips through parseResumeContent with expected sections", () => {
        const md = resumeDataToZipMarkdown(goldenResumeData());
        const doc = parseResumeContent(md);

        const headings = doc.sections.map((s) => s.heading);
        assert.ok(headings.includes("PROFESSIONAL SUMMARY"));
        assert.ok(headings.includes("CORE COMPETENCIES"));
        assert.ok(headings.includes("PROFESSIONAL EXPERIENCE"));
        assert.ok(headings.includes("EDUCATION & PROFESSIONAL DEVELOPMENT"));
        assert.ok(!headings.includes("INDEPENDENT PROJECTS"));

        const comp = doc.sections.find((s) => s.heading === "CORE COMPETENCIES");
        assert.ok(comp);
        const categories = comp!.blocks
            .filter((b) => b.kind === "competency")
            .map((b) => (b.kind === "competency" ? b.category : ""));
        assert.equal(categories.length, 3);
        assert.ok(categories.some((n) => /customer success/i.test(n)));
        assert.ok(categories.some((n) => /delivery/i.test(n)));
        assert.ok(categories.some((n) => /platform/i.test(n)));
    });
});
