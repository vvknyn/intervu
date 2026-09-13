import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    extractDigitRuns,
    heuristicTailorResume,
    introducesNewNumbers,
    looksRoboticTailor,
} from "../../src/lib/local-ai/tailor-resume";
import { buildModelPrompt, TAILOR_VOICE_RULES } from "../../src/lib/local-ai/tailor-with-engine";
import type { ResumeData } from "../../src/types/resume";

function mkResume(
    profile: Partial<ResumeData["profile"]>,
    experience: ResumeData["experience"] = [],
    competencies: ResumeData["competencies"] = [],
): ResumeData {
    return {
        profile: {
            name: "Jane Doe",
            profession: "Product Manager",
            yearsOfExperience: 6,
            location: "San Francisco",
            email: "jane@example.com",
            phone: "",
            ...profile,
        },
        experience,
        competencies,
        education: [],
        generatedSummary:
            "Product manager with 6 years driving product planning and cross-functional delivery.",
    };
}

const PM_RESUME = mkResume(
    { profession: "Product Manager", yearsOfExperience: 6 },
    [
        {
            id: "exp-1",
            company: "Acme Corp",
            role: "Senior Product Manager",
            dates: "2021 - Present",
            description:
                "Led product planning for B2B SaaS platform\nManaged roadmap prioritization with engineering\nIncreased revenue 20%",
        },
        {
            id: "exp-2",
            company: "Beta Inc",
            role: "Product Manager",
            dates: "2018 - 2021",
            description: "Owned feature discovery and user research for mobile app",
        },
    ],
    [{ category: "Skills", skills: ["Product planning", "Roadmap", "Agile", "SQL"] }],
);

const SWE_RESUME = mkResume(
    { profession: "Software Engineer", yearsOfExperience: 5 },
    [
        {
            id: "exp-swe-1",
            company: "TechCo",
            role: "Senior Software Engineer",
            dates: "2020 - Present",
            description: "Built distributed systems and REST APIs for payments platform",
        },
    ],
    [{ category: "Skills", skills: ["JavaScript", "TypeScript", "Node.js"] }],
);

describe("heuristicTailorResume", () => {
    it("PM job: summary mentions title, bullet uses JD overlap, companies unchanged, no new digits", () => {
        const draft = heuristicTailorResume(PM_RESUME, {
            title: "Product Manager",
            company: "Stripe",
            tags: ["roadmap", "product", "agile"],
            description:
                "Own the product roadmap and drive cross-functional planning. Lead agile delivery with engineering partners.",
            occupation: "Product Manager",
        });

        assert.match(draft.summaryAfter.toLowerCase(), /product manager/);
        assert.ok(!/Hands-on with/i.test(draft.summaryAfter));
        assert.equal(draft.engineId, "heuristic");
        assert.equal(draft.usedDescription, true);

        assert.ok(draft.bullets.length >= 1, "expected at least one bullet diff");

        const jdTerms = ["roadmap", "product", "planning", "agile"];
        const resumeTerms = ["product", "planning", "roadmap", "agile", "manager"];
        const hasOverlapBullet = draft.bullets.some((b) => {
            const afterLower = b.after.toLowerCase();
            return jdTerms.some(
                (t) =>
                    afterLower.includes(t) &&
                    (resumeTerms.some((r) => afterLower.includes(r)) || b.before.toLowerCase().includes(t)),
            );
        });
        assert.ok(hasOverlapBullet, "expected after-bullet to contain overlapping JD keyword");

        for (const b of draft.bullets) {
            assert.equal(b.company, PM_RESUME.experience.find((e) => e.id === b.experienceId)?.company);
            assert.equal(introducesNewNumbers(b.before, b.after), false);
        }

        for (const exp of draft.tailored.experience) {
            const orig = PM_RESUME.experience.find((e) => e.id === exp.id);
            assert.ok(orig);
            assert.equal(exp.company, orig!.company);
            assert.equal(exp.role, orig!.role);
            assert.equal(exp.dates, orig!.dates);
        }
    });

    it("engineer job does not invent a new employer", () => {
        const draft = heuristicTailorResume(SWE_RESUME, {
            title: "Backend Engineer",
            company: "Acme",
            tags: ["nodejs", "typescript", "distributed"],
            description: "Build scalable backend services.",
        });

        const employers = new Set(draft.tailored.experience.map((e) => e.company));
        assert.deepEqual([...employers], ["TechCo"]);
        assert.ok(!draft.tailored.experience.some((e) => e.company === "Acme"));
    });

    it("usedDescription false when description omitted", () => {
        const draft = heuristicTailorResume(PM_RESUME, {
            title: "Product Manager",
            tags: ["roadmap"],
        });
        assert.equal(draft.usedDescription, false);
        assert.equal(draft.engineId, "heuristic");
    });

    it("heuristic output avoids robotic templates", () => {
        const draft = heuristicTailorResume(PM_RESUME, {
            title: "Product Manager",
            company: "Stripe",
            tags: ["roadmap", "product", "agile"],
            description:
                "Own the product roadmap and drive cross-functional planning. Lead agile delivery with engineering partners.",
            occupation: "Product Manager",
        });

        assert.doesNotMatch(draft.summaryAfter, /Targeting .+ roles/i);
        assert.doesNotMatch(draft.summaryAfter, /Skilled in /i);
        assert.equal(looksRoboticTailor(draft.summaryAfter), false);

        for (const b of draft.bullets) {
            assert.doesNotMatch(b.after, /^Led .+ — /);
            assert.doesNotMatch(b.after, /aligned with .+ responsibilities/i);
            assert.equal(looksRoboticTailor(b.after), false);
        }
    });

    it("companies, dates, and numbers stay unchanged in heuristic tailor", () => {
        const draft = heuristicTailorResume(PM_RESUME, {
            title: "Product Manager",
            tags: ["roadmap"],
            description: "Drive roadmap planning.",
        });

        for (const exp of draft.tailored.experience) {
            const orig = PM_RESUME.experience.find((e) => e.id === exp.id);
            assert.ok(orig);
            assert.equal(exp.company, orig!.company);
            assert.equal(exp.role, orig!.role);
            assert.equal(exp.dates, orig!.dates);
        }

        for (const b of draft.bullets) {
            assert.equal(introducesNewNumbers(b.before, b.after), false);
        }
    });
});

describe("buildModelPrompt voice rules", () => {
    it("includes voice constraints and forbids Results-driven and Hands-on stubs", () => {
        const prompt = buildModelPrompt(PM_RESUME, {
            title: "Product Manager",
            tags: ["roadmap"],
        });
        assert.match(prompt, /Results-driven/);
        assert.match(prompt, /Hands-on with/i);
        assert.match(prompt, /not keyword-stuffed/i);
        assert.equal(prompt.includes(TAILOR_VOICE_RULES), true);
    });
});

describe("looksRoboticTailor", () => {
    it("flags Hands-on with stubs", () => {
        assert.equal(looksRoboticTailor("Hands-on with education and technology."), true);
        assert.equal(looksRoboticTailor("Recent focus includes product manager work."), true);
    });
});

describe("CSM heuristic tailor voice", () => {
    it("does not append Hands-on with for leftover JD tokens", () => {
        const csmResume = mkResume(
            {
                profession: "Customer Success Manager",
                yearsOfExperience: 12,
            },
            [
                {
                    id: "exp-csm",
                    company: "TELUS Health",
                    role: "Technical Account Manager",
                    dates: "2021 - Present",
                    description:
                        "Served as named Technical Account Manager for a $1.7M portfolio across enterprise accounts.",
                },
            ],
            [{ category: "Customer Success", skills: ["SLA governance", "QBRs"] }],
        );
        csmResume.generatedSummary =
            "Senior Customer Success and Technical Account Manager with 12 years driving adoption, retention, and revenue growth for enterprise SaaS accounts ($1.7M+ ARR). Proven record of building trusted-advisor relationships with C-level executives.";

        const draft = heuristicTailorResume(csmResume, {
            title: "Customer Success Manager",
            company: "Velai",
            tags: ["education", "learning", "account"],
            description:
                "Drive customer education programs and learning paths. Own strategic account relationships.",
            occupation: "Customer Success",
        });

        assert.ok(!/Hands-on with/i.test(draft.summaryAfter));
        assert.equal(looksRoboticTailor(draft.summaryAfter), false);
    });
});

describe("introducesNewNumbers", () => {
    it("detects new digit runs", () => {
        assert.equal(introducesNewNumbers("Increased revenue 20%", "Increased revenue 35%"), true);
        assert.equal(introducesNewNumbers("Team of 5 engineers", "Team of 5 engineers"), false);
        assert.equal(extractDigitRuns("20% and 3 teams").length, 2);
    });
});
