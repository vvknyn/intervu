import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    LOCAL_PARSE_ACCEPT_MIN,
    scoreLocalParseConfidence,
} from "../../src/lib/local-ai/parse-confidence";
import { descriptionToBullets } from "../../src/lib/resume/merge-bullet-lines";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");
const VIVEK_GOLDEN = readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-original-resume.txt"), "utf8");

describe("structureResumeText", () => {
    it("extracts name, profession, email, skills, experience from fixture", () => {
        const out = structureResumeText(FIXTURE);

        assert.equal(out.profile.name, "Jane Doe");
        assert.equal(out.profile.profession, "Senior Software Engineer");
        assert.equal(out.profile.email, "jane.doe@example.com");
        assert.match(out.profile.phone ?? "", /555/);
        assert.match(out.profile.linkedin ?? "", /linkedin\.com\/in\/janedoe/i);
        assert.ok((out.profile.yearsOfExperience ?? 0) > 0, "expected YoE > 0 from fixture dates");

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

    it("parses pipe-delimited single-line work history (Alex Rivera)", () => {
        const text = `Alex Rivera
Customer Success Manager
alex@example.com

WORK HISTORY
Customer Success Manager | Nimbus Health | Jan 2020 – Present
• Ran onboarding for 40 enterprise accounts
Account Manager | Northwind | Mar 2017 - Dec 2019
• Renewed $1.2M book

SKILLS
Salesforce, Gong, Excel`;
        const out = structureResumeText(text);

        assert.ok(out.experience.length >= 2, "expected at least 2 experience entries");
        const first = out.experience[0];
        assert.ok(
            /nimbus/i.test(first.company) || /customer success/i.test(first.role),
            "first entry should be Nimbus or CSM role",
        );
        assert.match(first.dates, /2020/i);
        assert.ok((out.profile.yearsOfExperience ?? 0) > 0, "expected YoE > 0");

        const score = scoreLocalParseConfidence(out);
        assert.ok(score.overall >= LOCAL_PARSE_ACCEPT_MIN, `expected ≥ ${LOCAL_PARSE_ACCEPT_MIN}, got ${score.overall}`);
    });

    it("parses experience from body without Experience header (Priya Shah)", () => {
        const text = `Priya Shah
Operations Lead
priya@ops.example

Ran fulfillment ops at Brightbox (2019–2024)
Warehouse Lead at Brightbox
June 2019 – March 2024
• Cut pick time 20%

SKILLS
Excel, SQL`;
        const out = structureResumeText(text);

        assert.ok(out.experience.length >= 1, "expected at least 1 experience entry");
        const entry = out.experience.find(
            (e) => /brightbox/i.test(e.company) || /warehouse|operations|fulfillment/i.test(e.role),
        );
        assert.ok(entry, "Brightbox or ops role entry missing");
        assert.ok(entry!.dates.length > 0, "expected dates on experience entry");
        assert.ok((out.profile.yearsOfExperience ?? 0) > 0, "expected YoE > 0");
    });

    it("recognizes alternate experience section headers", () => {
        const headers = [
            "Professional Background:",
            "Career History",
            "Employment History",
            "Relevant Experience:",
        ];

        for (const header of headers) {
            const text = `Sam Lee
Analyst
sam@example.com

${header}
Data Analyst | Contoso | 2020 - Present
• Built dashboards

SKILLS
SQL, Excel`;
            const out = structureResumeText(text);
            assert.ok(out.experience.length >= 1, `expected experience for header "${header}"`);
        }
    });

    it("parses classic 3-line Customer Success block", () => {
        const text = `Taylor Kim
Customer Success Manager
taylor@example.com

EXPERIENCE
Nimbus Health
Customer Success Manager
January 2020 – Present
• Owned 40 accounts

SKILLS
Salesforce`;
        const out = structureResumeText(text);

        assert.equal(out.experience.length, 1);
        assert.match(out.experience[0].company, /nimbus/i);
        assert.match(out.experience[0].role, /customer success/i);
        assert.match(out.experience[0].dates, /2020/i);
        assert.ok((out.profile.yearsOfExperience ?? 0) > 0);
    });

    it("fixture scores ≥ 91 overall confidence", () => {
        const out = structureResumeText(FIXTURE);
        const score = scoreLocalParseConfidence(out);
        assert.ok(score.overall >= LOCAL_PARSE_ACCEPT_MIN, `expected ≥ ${LOCAL_PARSE_ACCEPT_MIN}, got ${score.overall}`);
    });

    it("vivek golden: location is Richmond Hill, Ontario — not summary prose", () => {
        const out = structureResumeText(VIVEK_GOLDEN);
        assert.match(out.profile.location ?? "", /richmond hill/i);
        assert.match(out.profile.location ?? "", /ontario/i);
        assert.ok(!/into prioritized/i.test(out.profile.location ?? ""));
        assert.ok(!/shippable roadmaps/i.test(out.profile.location ?? ""));
    });

    it("vivek golden: rejects summary fragment as location when line 2 is malicious", () => {
        const malicious = VIVEK_GOLDEN.replace(
            "Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar | vivekn.xyz",
            "into prioritized, shippable roadmaps.",
        );
        const out = structureResumeText(malicious);
        assert.ok(!/into prioritized/i.test(out.profile.location ?? ""));
        assert.ok(!/shippable roadmaps/i.test(out.profile.location ?? ""));
    });

    it("vivek golden: parses three competency categories", () => {
        const out = structureResumeText(VIVEK_GOLDEN);
        assert.equal(out.competencies.length, 3);
        const names = out.competencies.map((c) => c.category);
        assert.ok(names.includes("Product"));
        assert.ok(names.some((n) => /delivery/i.test(n)));
        assert.ok(names.includes("Technical"));
        const technical = out.competencies.find((c) => c.category === "Technical");
        assert.ok((technical?.skills.length ?? 0) > 10, "Technical line should not be capped at 30 total");
    });

    it("merges PDF-extracted soft wrap into one MSA bullet (wrapped-source sample)", () => {
        const wrapped = [
            "Vivek Narayanan",
            "vivek@example.com",
            "PROFESSIONAL EXPERIENCE",
            "Client-facing Product Manager | TELUS Health Wellbeing    September '21 — Present",
            "- Owned the client-facing product roadmap for the Medibank wellbeing platform under a 3-year,",
            "multi-million-dollar MSA — translating client strategy into scoped, estimated, and",
            "prioritized SOWs across a $1.7M ARR, 2-account portfolio.",
        ].join("\n");
        const out = structureResumeText(wrapped);
        const telus = out.experience.find((e) => /telus/i.test(e.company));
        assert.ok(telus);
        const bullets = descriptionToBullets(telus!.description);
        assert.equal(bullets.length, 1);
        assert.ok(bullets[0].includes("translating client strategy"));
    });

    it("vivek golden: parses independent projects and education with intact institution", () => {
        const out = structureResumeText(VIVEK_GOLDEN);
        assert.ok(out.projects.length >= 2, `expected ≥2 projects, got ${out.projects.length}`);
        assert.ok(out.education.some((e) => /university of illinois urbana-champaign/i.test(e.institution)));
        assert.ok(out.education.some((e) => /university at buffalo/i.test(e.institution)));
        assert.ok(out.profile.website?.includes("vivekn.xyz"));
    });
});
