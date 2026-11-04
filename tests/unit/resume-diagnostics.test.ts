import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    analyzeResumeDiagnostics,
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
});
