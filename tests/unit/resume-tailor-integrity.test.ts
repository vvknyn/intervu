import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { enforceResumeIntegrity, screenAdvisoryRecommendations } from "@/lib/resume/tailor-integrity";
import type { ResumeData, TailoringRecommendation } from "@/types/resume";

/** Mirrors resume-base-resume.test.ts's blankResume() convention, filled in
 *  with real content so identity/number/skill/employer checks have something
 *  concrete to diff against. */
function baseResume(): ResumeData {
    return {
        profile: {
            name: "Jane Doe",
            profession: "Software Engineer",
            yearsOfExperience: 5,
            location: "NYC",
            email: "jane@example.com",
            phone: "555-0100",
        },
        experience: [
            {
                id: "exp-1",
                company: "Acme Corp",
                role: "Senior Engineer",
                dates: "2020 - 2023",
                description: "Led a team of 5 engineers. Grew revenue 20% through platform improvements.",
            },
            {
                id: "exp-2",
                company: "Widgets Inc",
                role: "Engineer",
                dates: "2018 - 2020",
                description: "Built internal tools used by 30 employees.",
            },
        ],
        competencies: [{ category: "Languages", skills: ["TypeScript", "Python"] }],
        education: [],
        generatedSummary: "Software engineer with 5 years of experience building scalable systems at Acme Corp.",
    };
}

describe("enforceResumeIntegrity", () => {
    it("reverts an experience entry whose company was invented, and correlates a dropped recommendation to it", () => {
        const original = baseResume();
        const proposed = {
            experience: [{ ...original.experience[0], company: "Google" }, original.experience[1]],
        };
        const rec: TailoringRecommendation = {
            id: "rec-1",
            category: "experience",
            priority: "high",
            title: "Highlight leadership",
            original: "Led a team of 5 engineers.",
            suggested: "Led a team of 5 engineers at Google.",
            reasoning: "Signals scale.",
        };

        const verdict = enforceResumeIntegrity(original, proposed, [rec]);

        assert.deepEqual(verdict.tailored.experience[0], original.experience[0]);
        assert.deepEqual(verdict.tailored.experience[1], original.experience[1]);
        assert.ok(verdict.violations.some((v) => v.includes("exp-1")));
        assert.equal(verdict.dropped.length, 1);
        assert.equal(verdict.dropped[0].id, "rec-1");
    });

    it("reverts only the experience entry with an invented metric, leaving other entries kept", () => {
        const original = baseResume();
        const proposed = {
            experience: [
                original.experience[0],
                {
                    ...original.experience[1],
                    description: "Built internal tools used by 30 employees, increasing retention 40%.",
                },
            ],
        };
        const rec: TailoringRecommendation = {
            id: "rec-2",
            category: "experience",
            priority: "medium",
            title: "Quantify retention impact",
            original: "Built internal tools used by 30 employees.",
            suggested: "Built internal tools used by 30 employees, increasing retention 40%.",
            reasoning: "Shows measurable impact.",
        };

        const verdict = enforceResumeIntegrity(original, proposed, [rec]);

        assert.deepEqual(verdict.tailored.experience[1], original.experience[1]);
        assert.deepEqual(verdict.tailored.experience[0], original.experience[0]);
        assert.equal(verdict.dropped.length, 1);
        assert.equal(verdict.dropped[0].id, "rec-2");
    });

    it("reverts an experience entry whose dates were altered even when company/role match", () => {
        const original = baseResume();
        const proposed = {
            experience: [{ ...original.experience[0], dates: "2020 - 2024" }, original.experience[1]],
        };

        const verdict = enforceResumeIntegrity(original, proposed, []);

        assert.deepEqual(verdict.tailored.experience[0], original.experience[0]);
        assert.ok(verdict.violations.some((v) => v.includes("exp-1") && v.includes("changed")));
    });

    it("removes an invented skill from competencies while keeping real skills", () => {
        const original = baseResume();
        const proposed = {
            competencies: [{ category: "Languages", skills: ["TypeScript", "Python", "Rust"] }],
        };

        const verdict = enforceResumeIntegrity(original, proposed, []);

        assert.deepEqual(verdict.tailored.competencies, [
            { category: "Languages", skills: ["TypeScript", "Python"] },
        ]);
        assert.ok(verdict.violations.some((v) => v.includes("Rust")));
    });

    it("reverts the summary when it mentions an employer absent from the original experience — a different section from the experience case, proving the rule is class-wide", () => {
        const original = baseResume();
        const proposed = {
            summary: "Software engineer with 5 years of experience building scalable systems at Netflix.",
        };

        const verdict = enforceResumeIntegrity(original, proposed, []);

        assert.equal(verdict.tailored.summary, original.generatedSummary);
        assert.ok(verdict.violations.some((v) => v.includes("Netflix")));
    });

    it("keeps a purely cosmetic rewording of summary, experience and competencies untouched, and drops nothing", () => {
        const original = baseResume();
        const proposedSummary = "Experienced software engineer (5 years) building scalable systems at Acme Corp.";
        const proposedExperience = [
            {
                ...original.experience[0],
                description: "Grew revenue 20% through platform improvements while leading a team of 5 engineers.",
            },
            original.experience[1],
        ];
        const proposedCompetencies = [{ category: "Languages", skills: ["Python", "TypeScript"] }];
        const rec: TailoringRecommendation = {
            id: "rec-3",
            category: "summary",
            priority: "low",
            title: "Tighten summary",
            suggested: proposedSummary,
            reasoning: "More concise.",
        };

        const verdict = enforceResumeIntegrity(
            original,
            { summary: proposedSummary, experience: proposedExperience, competencies: proposedCompetencies },
            [rec],
        );

        assert.equal(verdict.tailored.summary, proposedSummary);
        assert.equal(verdict.tailored.experience[0].description, proposedExperience[0].description);
        assert.deepEqual(verdict.tailored.experience[1], original.experience[1]);
        assert.deepEqual(verdict.tailored.competencies, proposedCompetencies);
        assert.equal(verdict.violations.length, 0);
        assert.equal(verdict.dropped.length, 0);
    });

    it("ignores profile/education fields injected into the proposal and logs a violation instead of using them", () => {
        const original = baseResume();
        const maliciousProposed = {
            summary: original.generatedSummary,
            experience: original.experience,
            competencies: original.competencies,
            profile: { ...original.profile, name: "Fake Name" },
            education: [{ id: "edu-1", degree: "Fake PhD", institution: "Fake University" }],
        };

        const verdict = enforceResumeIntegrity(original, maliciousProposed as any, []);

        assert.ok(verdict.violations.some((v) => v.includes("profile")));
        assert.ok(verdict.violations.some((v) => v.includes("education")));
        assert.equal(verdict.tailored.summary, original.generatedSummary);
        assert.deepEqual(verdict.tailored.experience, original.experience);
    });

    // Regression class: a digit followed by an ordinary word whose first
    // letter happens to be k/m/b ("3 backend", "5 marketing") must not read
    // as an invented unit-suffixed number ("3b", "5m"). Covered in two
    // different sections/letters to prove it's class-wide, not a fix for one
    // string — see reconcileExperience's rule 2 vs reconcileSummary's own
    // number check.
    it("does not mistake a b-initial word after a number in an experience description for an invented unit, and drops nothing", () => {
        const original = baseResume();
        const proposed = {
            experience: [
                { ...original.experience[0], description: "Led a team of 5 backend engineers. Grew revenue 20% through platform improvements." },
                original.experience[1],
            ],
        };
        const rec: TailoringRecommendation = {
            id: "rec-4",
            category: "experience",
            priority: "medium",
            title: "Clarify team composition",
            original: "Led a team of 5 engineers.",
            suggested: "Led a team of 5 backend engineers.",
            reasoning: "Matches the posting's backend focus.",
        };

        const verdict = enforceResumeIntegrity(original, proposed, [rec]);

        assert.equal(verdict.tailored.experience[0].description, proposed.experience[0].description);
        assert.equal(verdict.dropped.length, 0);
    });

    it("does not mistake a m-initial word after a number in the summary for an invented unit", () => {
        const original = baseResume();
        const proposed = {
            summary: "Software engineer with 5 marketing-adjacent years of experience building scalable systems at Acme Corp.",
        };

        const verdict = enforceResumeIntegrity(original, proposed, []);

        assert.equal(verdict.tailored.summary, proposed.summary);
        assert.equal(verdict.violations.length, 0);
    });

    it("still catches a genuine invented magnitude — '10 users' proposed as '10 million users'", () => {
        const original = baseResume();
        original.experience[0].description = "Supported 10 users across the platform.";
        const proposed = {
            experience: [
                { ...original.experience[0], description: "Supported 10 million users across the platform." },
                original.experience[1],
            ],
        };

        const verdict = enforceResumeIntegrity(original, proposed, []);

        assert.deepEqual(verdict.tailored.experience[0], original.experience[0]);
        assert.ok(verdict.violations.some((v) => v.includes("exp-1") && v.includes("10m")));
    });
});

describe("screenAdvisoryRecommendations", () => {
    // Advisory mode's base résumé is plain text — the exact fixture a
    // resume_text user would have. Every metric/employer used across the
    // three cases below is either present here (legitimate) or deliberately
    // absent (invented).
    const resumeText = [
        "Jane Doe — Software Engineer",
        "Software engineer with 5 years of experience building scalable systems at Acme Corp.",
        "Senior Engineer, Acme Corp (2020 - 2023): Led a team of 5 engineers. Grew revenue 20% through platform improvements.",
        "Engineer, Widgets Inc (2018 - 2020): Built internal tools used by 30 employees.",
        "Skills: TypeScript, Python.",
    ].join("\n");

    it("drops a recommendation that introduces a metric absent from the résumé text", () => {
        const rec: TailoringRecommendation = {
            id: "rec-1",
            category: "overall",
            priority: "high",
            title: "Quantify retention impact",
            suggested: "Mention that your platform work increased retention by 40%.",
            reasoning: "Retention is a hot topic for this employer.",
        };

        const { kept, dropped } = screenAdvisoryRecommendations(resumeText, [rec]);

        assert.equal(kept.length, 0);
        assert.equal(dropped.length, 1);
        assert.equal(dropped[0].id, "rec-1");
    });

    it("drops a recommendation that introduces an employer absent from the résumé text", () => {
        const rec: TailoringRecommendation = {
            id: "rec-2",
            category: "overall",
            priority: "medium",
            title: "Highlight relevant scale",
            suggested: "Lead with your experience at Netflix, since it matches the posting.",
            reasoning: "Signals scale.",
        };

        const { kept, dropped } = screenAdvisoryRecommendations(resumeText, [rec]);

        assert.equal(kept.length, 0);
        assert.equal(dropped.length, 1);
        assert.equal(dropped[0].id, "rec-2");
    });

    it("keeps a legitimate reorder recommendation whose named facts already appear in the résumé text", () => {
        const rec: TailoringRecommendation = {
            id: "rec-3",
            category: "overall",
            priority: "low",
            title: "Reorder your bullets",
            suggested: "Lead with your revenue growth of 20% at Acme Corp before the team-size detail.",
            reasoning: "This posting cares about revenue impact first.",
        };

        const { kept, dropped } = screenAdvisoryRecommendations(resumeText, [rec]);

        assert.equal(dropped.length, 0);
        assert.equal(kept.length, 1);
        assert.equal(kept[0].id, "rec-3");
    });
});
