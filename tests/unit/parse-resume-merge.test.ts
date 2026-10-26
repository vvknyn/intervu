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

    describe("one entry read twice is one entry; two entries are never one", () => {
        const NOW = new Date(2026, 9, 26);
        const job = (role: string, company: string, dates: string) => ({ role, company, dates, description: "• Built it" });
        const merge = (quick: Parameters<typeof mergeModelIntoHeuristic>[0], model: Record<string, unknown>) => mergeModelIntoHeuristic(quick, model, NOW).raw;

        it("is one role when the dates agree and the employers share a word, however each read spells them", () => {
            const raw = merge({ experience: [job("Senior Software Engineer", "Acme Corp, Toronto, ON", "2019 – Present")] }, { experience: [job("Sr. Software Engineer", "Acme", "Jan 2019 - Present")] });
            assert.deepEqual(raw.experience?.map((e) => [e.role, e.company]), [["Sr. Software Engineer", "Acme"]]);
        });

        it("keeps the earlier role at the same employer whose title the later one starts with", () => {
            const raw = merge(
                { experience: [job("Software Engineer II", "Google", "2020 – Present"), job("Software Engineer", "Google", "2018 – 2020")] },
                { experience: [job("Software Engineer II", "Google", "2020 – Present")] },
            );
            assert.deepEqual(raw.experience?.map((e) => [e.role, e.dates]), [["Software Engineer II", "2020 – Present"], ["Software Engineer", "2018 – 2020"]]);
        });

        it("never matches an empty name: a school-less MBA leaves both schools", () => {
            const raw = merge(
                { education: [{ degree: "MBA", institution: "Wharton", year: "Dec 2015" }, { degree: "", institution: "Lincoln High School", year: "2008" }] },
                { education: [{ degree: "MBA", institution: "" }] },
            );
            assert.deepEqual(raw.education?.map((e) => e.institution), ["Wharton", "Lincoln High School", ""]);
        });

        it("lists the merged roles newest first", () => {
            const raw = merge(
                { experience: [job("Lead", "Alder", "2022 – Present"), job("Engineer", "Birch", "2019 – 2022"), job("Intern", "Cedar", "2018")] },
                { experience: [job("Engineer", "Birch", "2019 – 2022")] },
            );
            assert.deepEqual(raw.experience?.map((e) => e.company), ["Alder", "Birch", "Cedar"]);
        });

        it("keeps C++, C# and C apart, in one list of each name", () => {
            const raw = merge({ competencies: [{ category: "Languages", skills: ["C++", "C", "Go"] }] }, { competencies: [{ category: "Languages", skills: ["C#"] }] });
            assert.deepEqual(raw.competencies, [{ category: "Languages", skills: ["C#", "C++", "C", "Go"] }]);
        });
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
