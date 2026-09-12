import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    LOCAL_PARSE_ACCEPT_MIN,
    scoreLocalParseConfidence,
} from "../../src/lib/local-ai/parse-confidence";
import { buildMatchQuery } from "../../src/lib/jobs/resume-match";
import { structureResumeText } from "../../src/lib/resume/structure-resume-text";
import type { ResumeData } from "../../src/types/resume";

const FIXTURE_PATH = path.join(process.cwd(), "tests/fixtures/vivek-okta-resume.txt");

function countCappedTitlePhrases(q: string): number {
    const suffix =
        /\b(Manager|Engineer|Lead|Owner|Developer|Analyst|Architect|Designer|Executive|Representative|Specialist|Scientist)\b/g;
    return [...q.matchAll(suffix)].length;
}

/** Normalize ASCII apostrophe to curly U+2019 when copy/paste loses Unicode. */
function loadOktaFixture(): string {
    return readFileSync(FIXTURE_PATH, "utf8").replace(/'/g, "\u2019");
}

describe("Vivek Okta résumé fixture", () => {
    it("parses 4+ experience entries with role, company, dates, and description", () => {
        const out = structureResumeText(loadOktaFixture());

        assert.ok(out.experience.length >= 4, `expected ≥4 roles, got ${out.experience.length}`);

        const expected = [
            { role: /client-facing product manager/i, company: /telus/i },
            { role: /technology lead/i, company: /tracxn/i },
            { role: /team lead/i, company: /zophop/i },
            { role: /senior software engineer/i, company: /optym/i },
        ];

        for (const { role, company } of expected) {
            const entry = out.experience.find(
                (e) => role.test(e.role) && company.test(e.company),
            );
            assert.ok(entry, `missing entry matching ${role} / ${company}`);
            assert.ok(entry!.dates.length > 0, "expected dates on entry");
            assert.ok(entry!.description.trim().length > 20, "expected non-empty description");
        }

        assert.ok((out.profile.yearsOfExperience ?? 0) >= 10, "expected YoE ≥ 10 from Feb 2013 start");

        const score = scoreLocalParseConfidence(out);
        assert.ok(
            score.overall >= LOCAL_PARSE_ACCEPT_MIN,
            `expected overall ≥ ${LOCAL_PARSE_ACCEPT_MIN}, got ${score.overall}`,
        );
    });

    it("buildMatchQuery surfaces PM and TAM/CSM-class roles, not the raw headline blob", () => {
        const structured = structureResumeText(loadOktaFixture()) as ResumeData;
        const { q, facets } = buildMatchQuery(structured);

        assert.match(q, /product manager/i, `q must include Product Manager, got: ${q}`);
        assert.ok(
            /technical account manager|customer success manager|implementation manager/i.test(q),
            `q should include TAM/CSM-class role, got: ${q}`,
        );
        assert.notEqual(
            q.trim(),
            "Customer Success Operations Manager | Technical Account Management",
            "must not use only the raw pipe-joined headline",
        );
        assert.ok(
            countCappedTitlePhrases(q) <= 4,
            `expected ≤4 capped title phrases, got ${countCappedTitlePhrases(q)}: ${q}`,
        );
        assert.deepEqual(facets.experience_level, ["mid", "senior"]);
    });

    it("parses PROFESSIONAL EXPERIENCE with Title | Company and Month ’YY — Present", () => {
        const text = `Alex Kim
Operations Manager
alex@example.com

PROFESSIONAL EXPERIENCE
Operations Manager | Brightbox Logistics | September ’21 — Present
Ran daily fulfillment ops and cut pick errors 15%.

SKILLS
Excel, SQL, JIRA`;

        const out = structureResumeText(text.replace(/'/g, "\u2019"));

        assert.ok(out.experience.length >= 1, "expected at least 1 experience entry");
        const entry = out.experience[0];
        assert.match(entry.role, /operations manager/i);
        assert.match(entry.company, /brightbox/i);
        assert.match(entry.dates, /’21|2021/i);
        assert.ok(entry.description.trim().length > 10);
    });
});
