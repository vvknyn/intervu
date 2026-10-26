import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    LOCAL_PARSE_COMPLETE_MIN,
    scoreLocalParseConfidence,
} from "../../src/lib/local-ai/parse-confidence";
import { resumeDataFromPlainText, structureResumeText } from "../../src/lib/resume/structure-resume-text";
import { markdownResumeToPlainText } from "../../src/lib/resume/markdown-text";
import { resumeDataToZipMarkdown } from "../../src/lib/resume/to-zip-markdown";
import { resumeDataToParsedDocument } from "../../src/lib/resume/parse-resume-content";
import { resumeMatchText } from "../../src/lib/resume/match-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

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
        assert.ok(score.overall >= LOCAL_PARSE_COMPLETE_MIN, `expected ≥ ${LOCAL_PARSE_COMPLETE_MIN}, got ${score.overall}`);
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

    it("reads a name with capitals inside it, and keeps its credentials in the printed name line", () => {
        for (const name of ["Mei-Ling Chen", "Siobhan McKenzie", "Liam O'Brien", "DeShawn Carter"]) {
            const out = structureResumeText(`${name}, CPA\nVancouver, BC | someone@example.com | 604-555-0110\n\nSUMMARY\nChartered accountant with eight years in audit.\n`);
            assert.equal(out.profile.name, name);
            assert.equal(out.sourceHeader?.nameLine, `${name}, CPA`);
            assert.deepEqual(out.sourceHeader?.contactLines, ["Vancouver, BC | someone@example.com | 604-555-0110"]);
        }
    });

    it("keeps a skills line the PDF wrapped under its category, and a plain line as a list of its own", () => {
        const out = structureResumeText([
            "Amara Okafor",
            "Hamilton, ON | amara@example.com | (905) 555-0142",
            "",
            "SKILLS",
            "Clinical: Hemodynamic monitoring, Ventilator care, Telemetry, Triage",
            "(CTAS)",
            "Systems: Epic, Meditech,",
            "Pyxis, Omnicell",
            "Certified in Advanced Cardiac Life Support",
        ].join("\n"));
        assert.deepEqual(out.competencies, [
            { category: "Clinical", skills: ["Hemodynamic monitoring", "Ventilator care", "Telemetry", "Triage (CTAS)"] },
            { category: "Systems", skills: ["Epic", "Meditech", "Pyxis", "Omnicell"] },
            { category: "", skills: ["Certified in Advanced Cardiac Life Support"] },
        ]);
    });

    it("takes the website from the person's own site, never from their email address", () => {
        assert.equal(structureResumeText(FIXTURE).profile.website ?? "", "", "jane.doe@example.com is not a website");
        const own = structureResumeText(
            "Lucja Wiśniewska\nGdańsk, Poland | lucja.w@example.com | lucja.design\n\nSUMMARY\nBrand marketer.\n",
        );
        assert.equal(own.profile.email, "lucja.w@example.com");
        assert.equal(own.profile.website, "lucja.design");
    });

    it("keeps roles and projects dated with a single year", () => {
        const out = structureResumeText([
            "Dana Moreau",
            "Calgary, AB | dana@example.com",
            "",
            "EXPERIENCE",
            "Junior Engineer | Red Deer Regional Water Commission 2009 – 2010",
            "Inspected reservoir liners and logged repairs.",
            "Employee of the Month 2010",
            "Survey Technician | Alberta Geomatics 2009",
            "Ran total-station surveys for road widening.",
            "",
            "PROJECTS",
            "Bow River Pathway Bridge (volunteer design review) 2022",
            "Reviewed the bridge's foundation design for a community group.",
            "Open-source culvert sizing calculator 2019",
            "Wrote a small web tool that sizes culverts from rainfall.",
            "",
            "SKILLS",
            "AutoCAD, Civil 3D",
        ].join("\n"));
        // "Employee of the Month 2010" doesn't read as a role, so it is not a job of its own.
        assert.deepEqual(
            out.experience.map((e) => [e.role, e.company, e.dates]),
            [
                ["Junior Engineer", "Red Deer Regional Water Commission", "2009 – 2010"],
                ["Survey Technician", "Alberta Geomatics", "2009"],
            ],
        );
        assert.deepEqual(
            out.projects?.map((p) => [p.role, p.dates]),
            [
                ["Bow River Pathway Bridge (volunteer design review)", "2022"],
                ["Open-source culvert sizing calculator", "2019"],
            ],
        );
        assert.match(out.projects![1].description, /culverts from rainfall/);
    });

    it("reads a résumé an agent filed in markdown as its words, not its marks", () => {
        const md = [
            "# Jane Doe",
            "Senior Software Engineer",
            "Toronto, ON | jane@example.com | [LinkedIn](https://linkedin.com/in/janedoe)",
            "",
            "## Professional Summary",
            "",
            "Backend engineer with **8 years** building payments systems.",
            "",
            "## Skills",
            "",
            "**Languages:** Go, TypeScript",
            "",
            "---",
            "",
            "## Experience",
            "",
            "### Senior Software Engineer | Stripe | 2021 – Present",
            "- Led the ledger migration to *Postgres*",
            "",
            "**Software Engineer** — Shopify — 2018 – 2021",
            "* Shipped checkout extensibility APIs",
            "",
            "## Education",
            "",
            "**BSc Computer Science**, University of Waterloo, 2016",
        ].join("\n");
        const data = resumeDataFromPlainText(md);
        assert.equal(data.profile.name, "Jane Doe");
        assert.equal(data.profile.profession, "Senior Software Engineer");
        assert.match(data.profile.linkedin ?? "", /linkedin\.com\/in\/janedoe/);
        assert.equal(data.generatedSummary, "Backend engineer with 8 years building payments systems.");
        assert.deepEqual(data.competencies, [{ category: "Languages", skills: ["Go", "TypeScript"] }]);
        assert.deepEqual(
            data.experience.map((e) => [e.role, e.company, e.dates, e.description]),
            [
                ["Senior Software Engineer", "Stripe", "2021 – Present", "• Led the ledger migration to Postgres"],
                ["Software Engineer", "Shopify", "2018 – 2021", "• Shipped checkout extensibility APIs"],
            ],
        );
        assert.equal(data.education[0].degree, "BSc Computer Science");
        const printed = resumeDataToParsedDocument(data);
        assert.equal(printed.name, "Jane Doe");
        assert.deepEqual(printed.sections.map((x) => x.heading), ["Professional Summary", "Skills", "Experience", "Education"]);
        assert.doesNotMatch(JSON.stringify(printed), /#|\*\*|\]\(/);
    });

    it("parses its own zip markdown (Role | Company over the dates) like the résumé it came from", () => {
        const plain = resumeDataFromPlainText(FIXTURE);
        const back = resumeDataFromPlainText(resumeDataToZipMarkdown(plain));
        assert.equal(back.profile.name, plain.profile.name);
        assert.equal(back.profile.profession, plain.profile.profession);
        assert.deepEqual(back.experience, plain.experience);
        assert.deepEqual(back.competencies, plain.competencies);
        assert.deepEqual(back.education, plain.education);
    });

    it("starts a new entry at a company / title / dates header instead of gluing it to the bullet above", () => {
        const out = structureResumeText(FIXTURE);
        assert.equal(out.experience[0].description.split("\n").at(-1), "• Reduced API latency by 40%");
        assert.deepEqual([out.experience[1].role, out.experience[1].company], ["Software Engineer", "Beta Systems"]);
    });

    it("reads an employer without the place printed beside it, as it always has, and never mistakes the employer for a place", () => {
        const read = (line: string) => structureResumeText(`Jane Sample\n\nEXPERIENCE\n${line}\n- Built things\n`).experience.map((e) => [e.role, e.company]);
        const lines: Array<[line: string, role: string, company: string]> = [
            ["Software Engineer | Acme Corp | Toronto, ON | Jan 2019 – Present", "Software Engineer", "Acme Corp"],
            ["Software Engineer | Acme Corp, Toronto, ON | Jan 2019 – Present", "Software Engineer", "Acme Corp, Toronto, ON"],
            ["Software Engineer, Acme Corp, Toronto, ON | Jan 2019 – Present", "Software Engineer", "Acme Corp"],
            ["Acme Corp, Toronto, ON | Jan 2019 – Present", "", "Acme Corp"],
            ["Software Engineer at Acme Corp, Toronto, ON | Jan 2019 – Present", "Software Engineer", "Acme Corp, Toronto, ON"],
            ["Software Engineer — Acme Corp — Chicago, IL — 2019 – 2021", "Software Engineer", "Acme Corp"],
            ["Nurse | Humber River Health | Toronto, ON | 2019 – 2021", "Nurse", "Humber River Health"],
            ["Software Engineer | Acme Corp | Payments Team | 2019 – 2021", "Software Engineer", "Acme Corp"],
            // Read before 2026-10-26 as a place, with no employer.
            ["Commis Chef, Ballymore House, Kinsale | 2019 – 2021", "Commis Chef", "Ballymore House"],
            ["Marketing Manager, Brightloop Media — Chicago, IL | 2019 – 2021", "Marketing Manager", "Brightloop Media"],
        ];
        assert.deepEqual(lines.map(([line]) => read(line)), lines.map(([, role, company]) => [[role, company]]));
    });

    it("keeps an experience section that names no role under its own heading, not in the last job", () => {
        const text = [
            "Asha Rao", "Professional Experience", "Programme Officer | Lakeside Trust | 2019 – Present",
            "• Ran field surveys", "Research Internship Experience", "Organisation: Riverside Institute",
            "Project: Mapping water use", "Education", "MA Sociology, Riverside University, 2018",
        ].join("\n");
        const out = resumeDataFromPlainText(text);
        assert.deepEqual(out.experience.map((e) => [e.role, e.company, e.description]), [["Programme Officer", "Lakeside Trust", "• Ran field surveys"]]);
        const kept = out.additionalSections?.find((s) => s.heading === "Research Internship Experience");
        assert.deepEqual(kept?.lines, ["Organisation: Riverside Institute", "Project: Mapping water use"]);
    });

    it("keeps each school's labelled lines with that school, and searches by its coursework", () => {
        const text = [
            "Asha Rao", "Education", "BSc Computer Science, Riverside University, 2018", "• GPA: 3.8/4.0",
            "• Relevant coursework: Algorithms, Databases; Operating Systems", "• Thesis: Mapping water use",
            "Baku State University, Azerbaijan 2015",
        ].join("\n");
        const out = resumeDataFromPlainText(text);
        assert.deepEqual(out.education.map((e) => [e.institution, e.year, e.gpa, e.coursework]), [
            ["Riverside University", "2018", "3.8/4.0", ["Algorithms", "Databases", "Operating Systems"]],
            ["Baku State University", "2015", undefined, undefined],
        ]);
        assert.deepEqual(out.additionalSections?.map((s) => [s.heading, s.after, s.lines]), [["Thesis", "education", ["Mapping water use"]]]);
        assert.match(resumeMatchText(out), /^Databases$/m);
    });

    it("keeps every job of a long history, and the words over its first one", () => {
        const jobs = Array.from({ length: 15 }, (_, n) => [`Analyst ${n + 1} | Firm ${n + 1} | ${2024 - n} – ${2025 - n}`, `• Built report ${n + 1}`]);
        const text = ["Asha Rao", "Experience", "Ten years of reporting for lenders.", ...jobs.flat()].join("\n");
        const out = resumeDataFromPlainText(text);
        assert.equal(out.experience.length, 15);
        assert.deepEqual(out.additionalSections?.map((s) => s.lines), [["Ten years of reporting for lenders."]]);
    });

    it("never opens a role at a project's duration line", () => {
        const out = resumeDataFromPlainText(["Asha Rao", "Projects", "Ledger | 2021", "- Built a ledger", "(6 months)"].join("\n"));
        assert.deepEqual(out.experience, []);
        assert.deepEqual(out.projects?.map((p) => [p.role || p.company, p.dates, p.description]), [["Ledger", "2021", "• Built a ledger\n• (6 months)"]]);
    });

    it("reads a 50,000-character line in linear time, every word of it kept", () => {
        // Trimming its trailing "=" run with a regex took 10.8 s before 2026-10-26.
        const line = `a${"=".repeat(50_000)}b`;
        const started = performance.now();
        const out = structureResumeText(["Asha Rao", "Experience", "Analyst | Firm | 2019 – 2021", line].join("\n"));
        const elapsed = performance.now() - started;
        assert.ok(JSON.stringify(out).includes(line), "the line was read and kept");
        assert.ok(elapsed < 2_000, `${Math.round(elapsed)} ms`);
    });

    it("names a skills list by its heading only when the heading says more than \"Skills\"", () => {
        const text = ["Asha Rao", "SKILLS", "Python, SQL, Tableau, dbt", "LANGUAGE SKILLS", "English, Hindi, Marathi, Tamil"].join("\n");
        assert.deepEqual(structureResumeText(text).competencies.map((c) => c.category), ["", "LANGUAGE SKILLS"]);
    });

    it("leaves plain text alone, even with a # or * in it", () => {
        const plain = "Ranked #1 of 40 reps\nC# developer, 5* rated\n* Built the pipeline";
        assert.equal(markdownResumeToPlainText(plain), plain);
    });

    it("fixture scores ≥ 91 overall confidence", () => {
        const out = structureResumeText(FIXTURE);
        const score = scoreLocalParseConfidence(out);
        assert.ok(score.overall >= LOCAL_PARSE_COMPLETE_MIN, `expected ≥ ${LOCAL_PARSE_COMPLETE_MIN}, got ${score.overall}`);
    });
});

describe("every entry lands in the section whose heading it sits under", () => {
    // Before 2026-10-26 a one-line school under EDUCATION was read as a job, and a project with no
    // work history beside it was read again as a job.
    type Layout = (first: string, second: string, dates: string) => string[];
    const layouts: Record<string, Layout> = {
        "on three lines": (first, second, dates) => [first, second, dates],
        "on one line split by |": (first, second, dates) => [`${first} | ${second} | ${dates}`],
        "on one line split by tabs": (first, second, dates) => [`${first}\t${second}\t${dates}`],
        "on one line split by commas": (first, second, dates) => [`${first}, ${second}, ${dates}`],
    };
    const sections: Record<string, (layout: Layout) => string[]> = {
        experience: (layout) => ["PROFESSIONAL EXPERIENCE", ...layout("Nurse", "City Hospital", "2018 - 2022"), "- Cared for twelve patients a shift"],
        education: (layout) => ["EDUCATION", ...layout("BSN", "Nursing College", "2014 - 2018")],
        projects: () => ["PROJECTS", "Ledger", "3 months"],
    };
    const orders = [
        ["experience", "education"],
        ["education", "experience"],
        ["experience", "projects", "education"],
        ["education", "projects", "experience"],
        ["projects", "education"],
        ["education", "projects"],
        ["projects"],
    ];
    for (const [layoutName, layout] of Object.entries(layouts)) {
        for (const order of orders) for (const gap of [[], [""]]) {
            it(`${order.join(", ")}, each entry ${layoutName}${gap.length ? ", a blank line between sections" : ""}`, () => {
                const body = order.flatMap((key) => [...sections[key](layout), ...gap]);
                const text = ["Casey Morgan", "casey.morgan@example.com", ...body, "SKILLS", "Excel, SQL"].join("\n");
                const out = structureResumeText(text);
                const has = (key: string) => order.includes(key);
                assert.deepEqual(
                    {
                        experience: out.experience.map((e) => [e.role, e.company]),
                        education: out.education.map((e) => [e.degree, e.institution]),
                        projects: out.projects.map((p) => p.role || p.company),
                    },
                    {
                        experience: has("experience") ? [["Nurse", "City Hospital"]] : [],
                        education: has("education") ? [["BSN", "Nursing College"]] : [],
                        projects: has("projects") ? ["Ledger"] : [],
                    },
                );
            });
        }
    }

    it("reads a heading by the word it ends on: appointments are jobs, qualifications are schools", () => {
        const read = (lines: string[]) => {
            const out = structureResumeText(["Casey Morgan", ...lines].join("\n"));
            return { experience: out.experience.map((e) => [e.role, e.company, e.description]), education: out.education.map((e) => [e.degree, e.institution]) };
        };
        assert.deepEqual(read(["Academic Appointments", "Assistant Professor | Example State University | 2019 - Present"]), {
            experience: [["Assistant Professor", "Example State University", ""]], education: [],
        });
        assert.deepEqual(read(["Academic Qualifications", "PhD Chemistry | University of Lagos | 2015"]), {
            experience: [], education: [["PhD Chemistry", "University of Lagos"]],
        });
        assert.deepEqual(read(["Experience", "Recruiter | Example Staffing | 2019 - 2022", "Filled twelve open positions"]), {
            experience: [["Recruiter", "Example Staffing", "• Filled twelve open positions"]], education: [],
        });
    });
});
