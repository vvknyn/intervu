import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildPackApplyPayload,
    packApplyLocationFacets,
    resumeForPackApply,
} from "../../src/lib/jobs/for-you/pack-apply-location";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import type { ResumeData } from "../../src/types/resume";

function resume(overrides: Partial<ResumeData> = {}): ResumeData {
    return {
        profile: {
            name: "Ada Lovelace",
            profession: "Engineer",
            yearsOfExperience: 6,
            location: "",
            email: "ada@example.com",
            phone: "",
            ...overrides.profile,
        },
        experience: overrides.experience ?? [],
        projects: overrides.projects ?? [],
        competencies: overrides.competencies ?? [],
        education: overrides.education ?? [],
        generatedSummary: overrides.generatedSummary ?? "",
    };
}

describe("pack apply candidate location", () => {
    it("uses a city already on the résumé for the apply payload and tailored résumé", () => {
        const source = resume({
            profile: {
                name: "Ada Lovelace",
                profession: "Engineer",
                yearsOfExperience: 6,
                location: "Richmond Hill, Ontario",
                email: "ada@example.com",
                phone: "",
            },
        });
        assert.equal(buildPackApplyPayload(source).candidateLocation, "Richmond Hill, Ontario");
        assert.equal(resumeForPackApply(source).profile.location, "Richmond Hill, Ontario");
        // Canada is filtered like every other country — no special case.
        assert.deepEqual(packApplyLocationFacets(source), { location_country: ["Canada"] });
    });

    it("sends the country, not the city, as the location the pack search filters on", () => {
        const source = resume({
            profile: {
                name: "Ada Lovelace",
                profession: "Engineer",
                yearsOfExperience: 6,
                location: "Austin, Texas",
                email: "ada@example.com",
                phone: "",
            },
        });
        assert.equal(buildPackApplyPayload(source).candidateLocation, "Austin, Texas");
        assert.deepEqual(packApplyLocationFacets(source), { location_country: ["United States"] });
    });

    it("recovers a city that sits in the résumé body when the profile field is empty", () => {
        const source = resume({
            generatedSummary: "Builds reliable systems.",
            experience: [
                {
                    id: "exp-1",
                    company: "Acme",
                    role: "Engineer",
                    dates: "2020 - Present",
                    description: "Richmond Hill, Ontario\nLed the migration.",
                },
            ],
        });
        assert.equal(buildPackApplyPayload(source).candidateLocation, "Richmond Hill, Ontario");
        assert.equal(resumeForPackApply(source).profile.location, "Richmond Hill, Ontario");
    });

    it("does not invent a city when the résumé has no location", () => {
        const source = resume({
            generatedSummary: "Builds reliable systems for enterprise teams.",
            experience: [
                {
                    id: "exp-1",
                    company: "Acme",
                    role: "Engineer",
                    dates: "2020 - Present",
                    description: "Led the migration of the billing platform.",
                },
            ],
        });
        assert.equal(buildPackApplyPayload(source).candidateLocation, null);
        assert.equal(resumeForPackApply(source).profile.location, "");
        assert.deepEqual(packApplyLocationFacets(source), {});
    });
});

describe("structureResumeText location beyond the first lines", () => {
    it("reads a city that appears after the old eight-line header window", () => {
        const filler = Array.from({ length: 10 }, () => "Ships product for enterprise teams.").join("\n");
        const text = `Ada Lovelace
Engineer
${filler}
Richmond Hill, Ontario | ada@example.com
EXPERIENCE
Acme
Engineer
2020 - Present
Led the migration.`;
        const parsed = structureResumeText(text);
        assert.match(parsed.profile.location ?? "", /Richmond Hill/);
    });

    it("reads a standalone city in the body when the header has no place", () => {
        const text = `Ada Lovelace
Engineer
ada@example.com
EXPERIENCE
Acme
Engineer
2020 - Present
Richmond Hill, Ontario
Led the migration.`;
        const parsed = structureResumeText(text);
        assert.match(parsed.profile.location ?? "", /Richmond Hill/);
    });

    it("leaves location empty when the résumé names no place", () => {
        const text = `Ada Lovelace
Engineer
ada@example.com
EXPERIENCE
Acme
Engineer
2020 - Present
Led the migration of the billing platform.
SKILLS
TypeScript, React`;
        const parsed = structureResumeText(text);
        assert.equal(parsed.profile.location ?? "", "");
    });
});
