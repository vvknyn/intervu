import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resumeIsUsable } from "../../src/lib/resume/resume-usable";
import { buildMatchQuery } from "../../src/lib/jobs/resume-match";
import type { ResumeData } from "../../src/types/resume";

// Single source of truth (moved out of src/app/jobs/page.tsx, previously a
// private, untested function there): both /jobs' local-state check
// (`hasUsableResume`) and the `hasUsableResumeOnFile` server action
// (actions/resume.ts) — the boolean-only presence signal for a returning
// user — read this SAME bar, so it can't drift into two different answers.
function blankResume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: {
            name: "",
            profession: "",
            yearsOfExperience: 0,
            location: "",
            email: "",
            phone: "",
        },
        experience: [],
        competencies: [],
        education: [],
        generatedSummary: "",
        ...overrides,
    };
}

describe("resumeIsUsable", () => {
    it("is false when no résumé is on hand at all", () => {
        assert.equal(resumeIsUsable(undefined), false);
    });

    it("is false for a résumé with neither a profession nor any skill", () => {
        assert.equal(resumeIsUsable(blankResume()), false);
    });

    it("is false when competencies exist but every skill entry is blank/whitespace", () => {
        assert.equal(
            resumeIsUsable(
                blankResume({ competencies: [{ category: "Tech", skills: ["", "   "] }] }),
            ),
            false,
        );
    });

    it("is true once a profession is set", () => {
        assert.equal(
            resumeIsUsable(
                blankResume({
                    profile: {
                        name: "",
                        profession: "Software Engineer",
                        yearsOfExperience: 0,
                        location: "",
                        email: "",
                        phone: "",
                    },
                }),
            ),
            true,
        );
    });

    it("is true once at least one real skill exists, even with no profession", () => {
        assert.equal(
            resumeIsUsable(
                blankResume({ competencies: [{ category: "Tech", skills: ["", "TypeScript"] }] }),
            ),
            true,
        );
    });
});

// GATE PASSES ⟺ NON-EMPTY QUERY. `resumeIsUsable` is defined directly in terms
// of `buildMatchQuery`'s own output (not a parallel "has a profession or a
// skill" re-derivation), so this invariant holds by construction rather than
// by the two checks happening to agree. Regression guard for the bug where a
// skills-only résumé passed `resumeIsUsable` while `buildMatchQuery` returned
// `q: ""` — the fit chip claimed "ranked by your résumé" over an unranked
// newest-first browse of the whole corpus.
describe("resumeIsUsable / buildMatchQuery invariant", () => {
    const cases: Array<[string, ResumeData]> = [
        ["neither profession nor skills", blankResume()],
        ["profession only", blankResume({ profile: { ...blankResume().profile, profession: "Nurse" } })],
        ["skills only", blankResume({ competencies: [{ category: "Tech", skills: ["Python"] }] })],
        [
            "profession and skills",
            blankResume({
                profile: { ...blankResume().profile, profession: "Nurse" },
                competencies: [{ category: "Tech", skills: ["Python"] }],
            }),
        ],
    ];

    for (const [label, resume] of cases) {
        it(`${label}: resumeIsUsable matches whether buildMatchQuery(q) is non-empty`, () => {
            assert.equal(resumeIsUsable(resume), Boolean(buildMatchQuery(resume).q));
        });
    }
});
