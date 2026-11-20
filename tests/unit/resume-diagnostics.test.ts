import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    analyzeResumeDiagnostics,
    consolidateOlderRoles,
    gerundToPastTense,
    tightenResumeBullet,
    tightenResumeData,
} from "../../src/lib/resume/resume-diagnostics";
import type { ResumeData } from "../../src/types/resume";

describe("gerundToPastTense: converts common gerunds to past tense", () => {
    it("handles irregular, doubled-consonant, silent-e, and regular verbs across fields", () => {
        for (const [ing, past] of [
            ["managing", "managed"],
            ["building", "built"],
            ["leading", "led"],
            ["coordinating", "coordinated"],
            ["streamlining", "streamlined"],
            ["planning", "planned"],
            ["shipping", "shipped"],
            ["analyzing", "analyzed"],
            ["improving", "improved"],
            ["reducing", "reduced"],
            ["documenting", "documented"],
            ["triaging", "triaged"],
            ["mentoring", "mentored"],
        ]) {
            assert.equal(gerundToPastTense(ing), past, `${ing} -> ${past}`);
        }
    });
});

describe("tightenResumeBullet: deterministic strong-verb & filler cleanup", () => {
    it("converts passive duty openers and strips filler words while preserving every fact and metric", () => {
        assert.equal(
            tightenResumeBullet("• Responsible for managing multiple warehouse shifts across 3 facilities."),
            "• Managed warehouse shifts across 3 facilities.",
        );
        assert.equal(
            tightenResumeBullet("• Successfully built various ETL pipelines that reduced latency by 40%."),
            "• Built ETL pipelines that reduced latency by 40%.",
        );
        assert.equal(
            tightenResumeBullet("Tasked with coordinating daily patient handoffs for 12 beds."),
            "Coordinated daily patient handoffs for 12 beds.",
        );
    });
});

describe("analyzeResumeDiagnostics & tightenResumeData", () => {
    const SAMPLE: ResumeData = {
        profile: {
            name: "Alex Rivera",
            profession: "Operations Lead",
            yearsOfExperience: 6,
            location: "Toronto, ON",
            email: "alex@example.com",
            phone: "",
        },
        experience: [
            {
                id: "exp-1",
                company: "Northwind",
                role: "Operations Lead",
                dates: "2021 - Present",
                description: [
                    "• Responsible for managing multiple vendor contracts across 4 regions",
                    "• Helped with onboarding new team members",
                    "• Reduced order processing time by 28% by redesigning the intake workflow",
                ].join("\n"),
            },
        ],
        projects: [],
        competencies: [],
        education: [],
        generatedSummary: "Results-driven operations lead with 6 years of experience.",
    };

    it("identifies weak openers, unquantified bullets, and filler/buzzwords", () => {
        const report = analyzeResumeDiagnostics(SAMPLE);
        assert.equal(report.totalBullets, 3);
        assert.equal(report.quantifiedBullets, 2);
        assert.equal(report.unquantifiedBullets.length, 1);
        assert.match(report.unquantifiedBullets[0]!.bullet, /Helped with onboarding/);
        assert.equal(report.weakOpeners.length, 2);
        assert.ok(report.fillerAndBuzzwords.length >= 2);
        assert.equal(report.tightenableCount, 1);
    });

    it("tightens convertible bullets without altering numbers or facts", () => {
        const { data, fixedCount } = tightenResumeData(SAMPLE);
        assert.equal(fixedCount, 1);
        assert.match(data.experience[0]!.description, /• Managed vendor contracts across 4 regions/);
        assert.match(data.experience[0]!.description, /28%/);
    });

    it("surfaces strategic recommendations for a 12+ year hybrid TAM + Software Engineer + Founder profile", () => {
        const HYBRID_FOUNDER: ResumeData = {
            profile: {
                name: "Vivek Narayanan",
                profession: "Technical Account Manager",
                yearsOfExperience: 13,
                location: "Toronto, ON",
                email: "viveknyan@gmail.com",
                phone: "+1 (437) 224-8332",
                linkedin: "linkedin.com/in/viveknar",
                website: "velai.app",
            },
            generatedSummary:
                "Enterprise Technical Account Manager with 13 years in B2B SaaS and software engineering: five years owning a $1.7M ARR portfolio after eight years as an engineer and lead.",
            competencies: [
                {
                    category: "Technical",
                    skills: ["SQL", "Python", "PostgreSQL", "TypeScript", "REST APIs", "LLMs & MCP"],
                },
            ],
            experience: [
                {
                    id: "exp-1",
                    company: "TELUS Health Wellbeing",
                    role: "Technical Account Manager",
                    dates: "September 2021 — Present",
                    description: [
                        "• Expanded the Medibank account through five statements of work ($1.7M ARR).",
                        "• Built an internal AI assistant over Slack, Jira, and Confluence.",
                        "• Engineered cross-customer support tooling adopted across 30+ customer companies.",
                        "• Averted a P1 and cut latency from 29s to under 3s.",
                    ].join("\n"),
                },
                {
                    id: "exp-2",
                    company: "Tracxn Technologies",
                    role: "Technology Lead",
                    dates: "July 2019 — February 2020",
                    description: "• Cut API development time 40% and lifted platform performance 15% by leading a 5-person engineering team.",
                },
                {
                    id: "exp-3",
                    company: "Zophop Technologies",
                    role: "Team Lead",
                    dates: "May 2018 — May 2019",
                    description: [
                        "• Lifted transit analytics accuracy 20% as primary customer lead for Bangalore's public transit authority.",
                        "• Raised GPS device availability 35% across 6,500 devices.",
                    ].join("\n"),
                },
                {
                    id: "exp-4",
                    company: "Optym",
                    role: "Senior Software Engineer",
                    dates: "February 2013 — April 2018",
                    description: [
                        "• Surfaced 4–5% operational cost savings for LTL freight customers.",
                        "• Lifted product adoption 80% by engineering a custom ETL layer.",
                        "• Participated in internal code reviews and team meetings.",
                    ].join("\n"),
                },
            ],
            projects: [
                {
                    id: "proj-1",
                    role: "velai.app",
                    company: "Founder",
                    dates: "2026 — Present",
                    description: "• Built and operate a live job-search platform over 2M+ postings with ghost-listing detection and an MCP interface for AI agents.",
                },
            ],
            education: [
                { id: "edu-1", degree: "MBA", institution: "University of Illinois Urbana-Champaign", year: "" },
                { id: "edu-2", degree: "MS, Computer Science", institution: "University at Buffalo", year: "" },
            ],
        };

        const report = analyzeResumeDiagnostics(HYBRID_FOUNDER);
        const ids = report.recommendations.map((r) => r.id);
        assert.deepEqual(ids, [
            "consolidate_older_roles",
            "hybrid_role_targeting",
            "emphasize_founder_build",
            "clickable_project_links",
        ]);
        assert.equal(report.consolidatableOlderBulletsCount, 1);

        const consolidateRec = report.recommendations.find((r) => r.id === "consolidate_older_roles")!;
        assert.match(consolidateRec.detail, /Tracxn Technologies, Zophop Technologies, and Optym/);
        assert.match(consolidateRec.detail, /1–2 'greatest hits' bullets/);

        const hybridRec = report.recommendations.find((r) => r.id === "hybrid_role_targeting")!;
        assert.match(hybridRec.detail, /overqualified for a standard 'Account Manager' role/);
        assert.match(hybridRec.detail, /'Head of Solutions', 'Founding Solutions Engineer', 'Forward Deployed Engineer'/);

        const founderRec = report.recommendations.find((r) => r.id === "emphasize_founder_build")!;
        assert.match(founderRec.detail, /velai\.app/);
        assert.match(founderRec.detail, /MBA/);

        const { data: consolidated, removedCount } = consolidateOlderRoles(HYBRID_FOUNDER, 2, 2026);
        assert.equal(removedCount, 1);
        const optymBullets = consolidated.experience[3]!.description.split("\n");
        assert.equal(optymBullets.length, 2);
        assert.ok(optymBullets.some((b) => /80%/.test(b)), "keeps quantified 80% bullet");
        assert.ok(!optymBullets.some((b) => /team meetings/.test(b)), "drops unquantified 3rd bullet");
    });
});
