import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

describe("structureResumeText", () => {
    it("extracts name, profession, email, skills, experience from fixture", () => {
        const out = structureResumeText(FIXTURE);

        assert.equal(out.profile.name, "Jane Doe");
        assert.equal(out.profile.profession, "Senior Software Engineer");
        assert.equal(out.profile.email, "jane.doe@example.com");
        assert.match(out.profile.phone ?? "", /555/);
        assert.match(out.profile.linkedin ?? "", /linkedin\.com\/in\/janedoe/i);

        assert.ok(out.experience.length >= 2, "expected at least 2 experience entries");
        const acme = out.experience.find((e) => /acme/i.test(e.company));
        assert.ok(acme, "Acme Corp entry missing");
        assert.match(acme!.role, /Senior Software Engineer/i);
        assert.match(acme!.dates, /2020/i);

        assert.ok(out.competencies.length > 0);
        const skills = out.competencies.flatMap((c) => c.skills);
        assert.ok(skills.some((s) => /typescript/i.test(s)));
        assert.ok(skills.some((s) => /react/i.test(s)));

        assert.ok(out.generatedSummary.length > 20);
    });

    it("handles minimal paste with contact line", () => {
        const text = `John Smith
Product Manager
john@corp.io

EXPERIENCE
BigCo
Product Manager
2021 - Present
• Shipped features

SKILLS
Roadmaps, SQL`;
        const out = structureResumeText(text);
        assert.equal(out.profile.name, "John Smith");
        assert.equal(out.profile.email, "john@corp.io");
        assert.equal(out.profile.profession, "Product Manager");
    });
});
