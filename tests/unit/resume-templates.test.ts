import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { extractPDFTextInBrowser } from "../../src/lib/local-ai/extract-in-browser";
import { buildMatchQuery } from "../../src/lib/jobs/resume-match";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import { TEMPLATES, sectionRecall, share, templateResumePdf, unplacedLines, type Recall } from "../fixtures/resume-templates/harness";

/**
 * Every template people send (caps, Title Case and colon headings; Career
 * History, Employment, Work History and their kin; letter-spaced and
 * symbol headings; two columns; tables; no headings at all; LinkedIn,
 * Europass, academic and functional layouts; dates as 05/2019, 2019-2021,
 * "Jan 2020 – Present", durations on their own line or a right-aligned tab,
 * or none), pasted and uploaded as a PDF.
 * The quick read must find at least 95% of each one's roles, schools and
 * skills, 99% across them all, keep every line it was given somewhere, and
 * search /jobs by what it read.
 *
 * Before 2026-10-26 it read 8 of the 44 in full, and found 23 of 51 pasted
 * roles (25 uploaded), 19 of 29 schools and 109 of 149 skills.
 */

const MIN_RECALL = 0.95;
const MIN_CORPUS_RECALL = 0.99;
const SECTIONS = ["experience", "education", "skills"] as const;

describe("résumé templates: the quick read gets every section from every layout", () => {
    it("has the twenty-three templates", () => assert.equal(TEMPLATES.length, 23));

    const corpus: Record<string, Recall> = {};
    for (const { id, text, truth } of TEMPLATES) {
        const paths = {
            paste: async () => text,
            upload: async () => {
                const read = await extractPDFTextInBrowser(templateResumePdf(text, truth.pdfColumn));
                assert.ok(read.text, read.error);
                return read.text;
            },
        };
        for (const [via, source] of Object.entries(paths)) {
            it(`${id} (${via})`, async () => {
                const input = await source();
                const parsed = (await parseResumeLocally(input)).data.parsed;
                const recall = sectionRecall(parsed, truth);
                for (const section of SECTIONS) {
                    const sum = (corpus[`${via} ${section}`] ??= { found: 0, total: 0 });
                    sum.found += recall[section].found;
                    sum.total += recall[section].total;
                }
                const read = {
                    experience: parsed.experience.map((e) => `${e.role} @ ${e.company}`),
                    education: parsed.education.map((e) => `${e.degree} @ ${e.institution}`),
                    skills: parsed.competencies.flatMap((c) => c.skills),
                };
                for (const section of SECTIONS) {
                    const { found, total } = recall[section];
                    assert.ok(share(recall[section]) >= MIN_RECALL, `${section} ${found}/${total}: ${JSON.stringify(read[section])}`);
                }
                assert.deepEqual(unplacedLines(input, parsed, truth), [], "every line is kept");
                assert.ok(buildMatchQuery(parsed).q, "it searches /jobs");
            });
        }
    }

    it("reads every part of every template without throwing: each prefix and each suffix, cut at a line", () => {
        const thrown = TEMPLATES.flatMap(({ id, text }) => {
            const lines = text.split("\n");
            const parts = lines.flatMap((_, n) => [[`${id} first ${n + 1} lines`, lines.slice(0, n + 1)], [`${id} from line ${n + 1}`, lines.slice(n)]] as const);
            return parts.flatMap(([label, part]) => {
                try {
                    structureResumeText(part.join("\n"));
                    return [];
                } catch (error) {
                    return [`${label}: ${(error as Error).message}`];
                }
            });
        });
        assert.deepEqual(thrown, []);
    });

    it("finds at least 99% of every section across all of them, pasted and uploaded", (t) => {
        assert.equal(Object.keys(corpus).length, SECTIONS.length * 2, "every template was read");
        const read = Object.entries(corpus).map(([key, sum]) => ({ key, sum, line: `${key} ${sum.found}/${sum.total}` }));
        for (const { line } of read) t.diagnostic(line);
        assert.deepEqual(read.filter(({ sum }) => share(sum) < MIN_CORPUS_RECALL).map(({ line }) => line), []);
    });
});
