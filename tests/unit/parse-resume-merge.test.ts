import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mergeModelIntoHeuristic, parseModelJson, readSealedPrompt } from "../../src/lib/local-ai/parse-resume";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";

const FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

describe("mergeModelIntoHeuristic", () => {
    it("empty model object does not clobber heuristic name, email, or experience", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {},
        );

        assert.equal(usedHeuristic, true);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.email, "jane.doe@example.com");
        assert.ok((raw.experience?.length ?? 0) >= 2);
    });

    it("empty-string profile fields from model do not overwrite heuristic values", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {
                profile: {
                    name: "",
                    email: "",
                    profession: "   ",
                    phone: "",
                },
                experience: [{ company: "", role: "" }],
                competencies: [{ category: "Skills", skills: [""] }],
                education: [{ degree: "", institution: "" }],
                generatedSummary: "",
            },
        );

        assert.equal(usedHeuristic, true);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.email, "jane.doe@example.com");
        assert.equal(raw.profile?.profession, "Senior Software Engineer");
        assert.ok((raw.experience?.length ?? 0) >= 2);
    });

    it("merges non-empty model fields and marks model as contributor", () => {
        const heuristic = structureResumeText(FIXTURE);
        const { raw, usedHeuristic } = mergeModelIntoHeuristic(
            {
                profile: heuristic.profile,
                experience: heuristic.experience,
                competencies: heuristic.competencies,
                education: heuristic.education,
                generatedSummary: heuristic.generatedSummary,
            },
            {
                profile: { location: "Boston, MA" },
                generatedSummary: "Strong backend engineer with platform focus.",
            },
        );

        assert.equal(usedHeuristic, false);
        assert.equal(raw.profile?.name, "Jane Doe");
        assert.equal(raw.profile?.location, "Boston, MA");
        assert.equal(raw.generatedSummary, "Strong backend engineer with platform focus.");
    });

    it("keeps every entry the quick read found that the model's shorter read left out", () => {
        const { raw } = mergeModelIntoHeuristic(
            {
                experience: [
                    { role: "Data Analyst", company: "Northwind Traders" },
                    { role: "Analyst Intern", company: "Contoso" },
                    { role: "Research Assistant", company: "Fabrikam University" },
                ],
                competencies: [{ category: "Skills", skills: ["python", "SQL", "Tableau"] }],
                education: [
                    { degree: "MSc Statistics", institution: "Fabrikam University" },
                    { degree: "BSc Mathematics", institution: "Tailspin College" },
                ],
            },
            {
                // A reply cut at its token cap: one role with its place added, one with role and company swapped.
                experience: [
                    { role: "Data Analyst", company: "Northwind Traders – Seattle, WA" },
                    { role: "Contoso", company: "Analyst Intern" },
                ],
                competencies: [{ category: "Languages", skills: ["Python"] }],
                education: [{ degree: "MSc Statistics", institution: "Fabrikam University" }],
            },
        );

        assert.deepEqual(raw.experience?.map((e) => e.role), ["Data Analyst", "Contoso", "Research Assistant"]);
        assert.deepEqual(raw.competencies, [
            { category: "Languages", skills: ["Python"] },
            { category: "Skills", skills: ["SQL", "Tableau"] },
        ]);
        assert.deepEqual(raw.education?.map((e) => e.degree), ["MSc Statistics", "BSc Mathematics"]);
    });
});

describe("parseModelJson", () => {
    it("reads a whole reply, with prose around it", () => {
        assert.deepEqual(parseModelJson('Here it is: {"experience":[{"role":"Analyst"}]} Done.'), { experience: [{ role: "Analyst" }] });
    });

    it("keeps what a reply cut off at its token cap had finished", () => {
        const cut = '{"experience":[{"role":"Lead \\"}\\" engineer","company":"Contoso"},{"role":"Data Ana';
        assert.deepEqual(parseModelJson(cut), { experience: [{ role: 'Lead "}" engineer', company: "Contoso" }] });
    });

    it("is null when nothing in the reply closed", () => {
        assert.equal(parseModelJson('{"experience":[{"role":"Data Ana'), null);
        assert.equal(parseModelJson("no json here"), null);
    });
});

describe("readSealedPrompt", () => {
    it("sends whole lines only when the résumé is longer than the model reads", () => {
        const lines = Array.from({ length: 200 }, (_, i) => `• Line ${i} ${"x".repeat(60)}`);
        const sent = readSealedPrompt(lines.join("\n")).split('"""')[1].trim().split("\n");
        assert.ok(sent.length < lines.length, "the text was cut");
        assert.deepEqual(sent, lines.slice(0, sent.length));
    });
});
