import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    extractDigitRuns,
    heuristicTailorResume,
    introducesNewNumbers,
    looksRoboticTailor,
    resumeFullText,
    type TailorDraft,
} from "../../src/lib/local-ai/tailor-resume";
import {
    applyModelTailor,
    buildModelPrompt,
    ENGINE_LABELS,
    groundDraft,
    TAILOR_VOICE_RULES,
} from "../../src/lib/local-ai/tailor-with-engine";
import { descriptionToBullets } from "../../src/lib/resume/merge-bullet-lines";
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

    it("summary unchanged when the job title has no overlap with the résumé (no fabricated claim)", () => {
        const draft = heuristicTailorResume(PM_RESUME, {
            title: "Welding Technician",
            tags: ["welding", "metal", "fabrication"],
            description: "Weld and fabricate metal components using MIG and TIG welding techniques.",
        });

        assert.equal(draft.summaryAfter, draft.summaryBefore);
        assert.doesNotMatch(draft.summaryAfter, /recent focus/i);
        assert.doesNotMatch(draft.summaryAfter, /welding/i);
    });

    it("also tailors project bullets (source: project), same rules as experience, without inventing numbers", () => {
        const resumeWithProject: ResumeData = {
            ...PM_RESUME,
            projects: [
                {
                    id: "proj-1",
                    company: "Side Project",
                    role: "Creator",
                    dates: "2022",
                    description: "Built a roadmap planning tool for internal agile teams",
                },
            ],
        };
        const draft = heuristicTailorResume(resumeWithProject, {
            title: "Product Manager",
            tags: ["roadmap", "agile"],
            description: "Own the product roadmap. Lead agile delivery with engineering partners.",
        });

        const projectBullet = draft.bullets.find((b) => b.source === "project");
        assert.ok(projectBullet, "expected a project bullet diff");
        assert.equal(projectBullet!.experienceId, "proj-1");
        assert.equal(introducesNewNumbers(projectBullet!.before, projectBullet!.after), false);

        const tailoredProject = draft.tailored.projects?.find((p) => p.id === "proj-1");
        assert.ok(tailoredProject);
        assert.ok(tailoredProject!.description.includes(projectBullet!.after));

        // Class-wide: experience bullets are tagged too, not just project ones.
        assert.ok(draft.bullets.every((b) => b.source === "experience" || b.source === "project"));
        assert.ok(draft.bullets.some((b) => b.source === "experience"));
    });
    it("leaves the other lines of a rewritten entry as they were, bullet markers included", () => {
        const resume = mkResume({ profession: "Registered Nurse" }, [
            {
                id: "exp-rn",
                company: "St. Michael's Hospital",
                role: "Registered Nurse",
                dates: "2022 - Present",
                description:
                    "• Triage and assess 30+ patients per shift in a level 1 trauma centre\n• Administer medications and IV therapy, document care in Epic\n• Coordinate with physicians on critically ill patients",
            },
        ]);
        const draft = heuristicTailorResume(resume, {
            title: "Registered Nurse - ICU",
            description: "Patient assessment, ventilator management and IV therapy. Triage of critically ill patients.",
        });
        const after = draft.tailored.experience[0].description;
        // Unpunctuated lines without their markers would be read back as one long bullet.
        assert.equal(descriptionToBullets(after).length, 3);
        assert.match(after, /\n• Administer medications/);
        assert.match(after, /\n• Coordinate with physicians/);
    });
});

describe("resumeFullText", () => {
    it("includes project description text, so a projects-only résumé still builds a matchable vocabulary", () => {
        const projectsOnlyResume: ResumeData = {
            ...mkResume({}, [], []),
            projects: [
                {
                    id: "proj-1",
                    company: "",
                    role: "Creator",
                    dates: "2023",
                    description: "Built a Kubernetes deployment pipeline for a personal project",
                },
            ],
        };
        const text = resumeFullText(projectsOnlyResume).toLowerCase();
        assert.ok(text.includes("kubernetes"), `expected project text in résumé full text, got: ${text}`);
    });
});

describe("buildModelPrompt voice rules", () => {
    it("includes voice constraints and forbids Results-driven", () => {
        const prompt = buildModelPrompt(PM_RESUME, {
            title: "Product Manager",
            tags: ["roadmap"],
        });
        assert.match(prompt, /Results-driven/);
        assert.match(prompt, /not keyword-stuffed/i);
        assert.equal(prompt.includes(TAILOR_VOICE_RULES), true);
    });
});

describe("introducesNewNumbers", () => {
    it("detects new digit runs", () => {
        assert.equal(introducesNewNumbers("Increased revenue 20%", "Increased revenue 35%"), true);
        assert.equal(introducesNewNumbers("Team of 5 engineers", "Team of 5 engineers"), false);
        assert.equal(extractDigitRuns("20% and 3 teams").length, 2);
    });
});

describe("groundDraft", () => {
    function draftWithBullet(before: string, after: string): TailorDraft {
        const tailored = JSON.parse(JSON.stringify(PM_RESUME)) as ResumeData;
        const expIdx = tailored.experience.findIndex((e) => e.id === "exp-1");
        tailored.experience[expIdx] = {
            ...tailored.experience[expIdx],
            description: tailored.experience[expIdx].description.replace(before, after),
        };
        return {
            engineId: "heuristic",
            engineLabel: ENGINE_LABELS.heuristic,
            usedDescription: true,
            summaryBefore: PM_RESUME.generatedSummary,
            summaryAfter: PM_RESUME.generatedSummary,
            bullets: [
                {
                    experienceId: "exp-1",
                    source: "experience",
                    company: "Acme Corp",
                    role: "Senior Product Manager",
                    before,
                    after,
                },
            ],
            tailored,
        };
    }

    it("drops a heuristic-style bullet that introduces a digit absent from the original", () => {
        const before = "Led product planning for B2B SaaS platform";
        const after = "Led product planning for B2B SaaS platform 5";
        const draft = groundDraft(resumeFullText(PM_RESUME), draftWithBullet(before, after));

        assert.equal(draft.bullets.length, 0);
        const description = draft.tailored.experience.find((e) => e.id === "exp-1")!.description;
        assert.ok(description.includes(before));
        assert.ok(!description.includes(after));
    });

    it("drops a model-branch-style bullet that introduces a skill word absent from the résumé", () => {
        const before = "Managed roadmap prioritization with engineering";
        const after = "Managed roadmap prioritization with Kubernetes";
        const draft = groundDraft(resumeFullText(PM_RESUME), draftWithBullet(before, after));

        assert.equal(draft.bullets.length, 0);
        const description = draft.tailored.experience.find((e) => e.id === "exp-1")!.description;
        assert.ok(description.includes(before));
        assert.ok(!description.includes(after));
    });

    function draftWithProjectBullet(before: string, after: string): { resume: ResumeData; draft: TailorDraft } {
        const resume: ResumeData = {
            ...PM_RESUME,
            projects: [{ id: "proj-1", company: "Side Project", role: "Creator", dates: "2022", description: before }],
        };
        const tailored = JSON.parse(JSON.stringify(resume)) as ResumeData;
        tailored.projects = [{ ...tailored.projects![0], description: after }];
        return {
            resume,
            draft: {
                engineId: "heuristic",
                engineLabel: ENGINE_LABELS.heuristic,
                usedDescription: true,
                summaryBefore: resume.generatedSummary,
                summaryAfter: resume.generatedSummary,
                bullets: [
                    { experienceId: "proj-1", source: "project", company: "Side Project", role: "Creator", before, after },
                ],
                tailored,
            },
        };
    }

    it("drops a project bullet that introduces a fabricated skill word absent from the résumé (same gate as experience)", () => {
        const before = "Built a roadmap planning tool for internal agile teams";
        const after = "Built a roadmap planning tool using Kubernetes for internal agile teams";
        const { resume, draft } = draftWithProjectBullet(before, after);
        const grounded = groundDraft(resumeFullText(resume), draft);

        assert.equal(grounded.bullets.length, 0);
        const description = grounded.tailored.projects!.find((p) => p.id === "proj-1")!.description;
        assert.ok(description.includes(before));
        assert.ok(!description.includes(after));
    });
});

describe("applyModelTailor (model lane)", () => {
    const PM_RESUME_WITH_PROJECT: ResumeData = {
        ...PM_RESUME,
        projects: [
            {
                id: "proj-1",
                company: "Side Project",
                role: "Creator",
                dates: "2022",
                description: "Built a roadmap planning tool for internal agile teams",
            },
        ],
    };

    it("drops a project bullet from a fake engine that introduces a skill word absent from the résumé", () => {
        const fakeEngineOutput = {
            summary: PM_RESUME.generatedSummary,
            bullets: [
                {
                    experienceId: "proj-1",
                    text: "Built a roadmap planning tool using Kubernetes for internal agile teams",
                },
            ],
        };
        const draft = applyModelTailor(PM_RESUME_WITH_PROJECT, { title: "Product Manager" }, fakeEngineOutput, "webllm");
        assert.ok(draft, "expected a draft (bullet matched before grounding)");

        const grounded = groundDraft(resumeFullText(PM_RESUME_WITH_PROJECT), draft!);
        assert.equal(grounded.bullets.length, 0);

        const description = grounded.tailored.projects!.find((p) => p.id === "proj-1")!.description;
        assert.ok(description.includes("Built a roadmap planning tool for internal agile teams"));
        assert.ok(!description.includes("Kubernetes"));
    });

    it("accepts a grounded project bullet from a fake engine with source: project", () => {
        const fakeEngineOutput = {
            summary: PM_RESUME.generatedSummary,
            bullets: [
                {
                    experienceId: "proj-1",
                    text: "Built a roadmap planning tool for internal agile delivery",
                },
            ],
        };
        const draft = applyModelTailor(PM_RESUME_WITH_PROJECT, { title: "Product Manager" }, fakeEngineOutput, "webllm");
        assert.ok(draft);

        const grounded = groundDraft(resumeFullText(PM_RESUME_WITH_PROJECT), draft!);
        assert.equal(grounded.bullets.length, 1);
        assert.equal(grounded.bullets[0].source, "project");
        assert.equal(grounded.bullets[0].experienceId, "proj-1");
        assert.ok(
            grounded.tailored.projects!.find((p) => p.id === "proj-1")!.description.includes("agile delivery"),
        );
    });

    it("generic-fix: an experience bullet through the same shared step is unaffected, and a projects-only résumé still yields project diffs", () => {
        const expOutput = {
            summary: PM_RESUME.generatedSummary,
            bullets: [
                { experienceId: "exp-1", text: "Led product planning across the B2B SaaS platform and mobile app." },
            ],
        };
        const draft = applyModelTailor(PM_RESUME, { title: "Product Manager" }, expOutput, "webllm");
        assert.ok(draft);
        assert.equal(draft!.bullets.length, 1);
        assert.equal(draft!.bullets[0].source, "experience");
        assert.equal(draft!.bullets[0].experienceId, "exp-1");
        assert.equal(draft!.bullets[0].company, "Acme Corp");

        const projectsOnlyResume: ResumeData = {
            ...mkResume({ profession: "Product Manager", yearsOfExperience: 3 }, [], []),
            projects: [
                {
                    id: "proj-2",
                    company: "Open Source",
                    role: "Maintainer",
                    dates: "2023",
                    description: "Maintains a roadmap planning tool for agile teams",
                },
            ],
        };
        const projectOutput = {
            summary: projectsOnlyResume.generatedSummary,
            bullets: [
                { experienceId: "proj-2", text: "Maintains a roadmap planning tool for distributed agile teams" },
            ],
        };
        const noExpDraft = applyModelTailor(projectsOnlyResume, { title: "Product Manager" }, projectOutput, "webllm");
        assert.ok(noExpDraft, "expected project diffs even with an empty experience array");
        assert.equal(noExpDraft!.bullets.length, 1);
        assert.equal(noExpDraft!.bullets[0].source, "project");
        assert.equal(noExpDraft!.bullets[0].experienceId, "proj-2");
    });
});
