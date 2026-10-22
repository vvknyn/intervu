import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPLOYMENT_TYPES } from "../../src/lib/agent/facets";
import { parseEmploymentTypeTokens } from "../../src/lib/jobs/query-tokens/employment-type";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";

const cases: [string, string[], string][] = [
    ["part time UX researcher in Vancouver", ["part_time"], "UX researcher in Vancouver"],
    ["Part-Time barista", ["part_time"], "barista"],
    ["contract react developer", ["contract"], "react developer"],
    ["contractor devops", ["contract"], "devops"],
    ["internship software engineering summer", ["internship"], "software engineering summer"],
    ["software engineer intern", ["internship"], "software engineer"],
    ["full time backend engineer", ["full_time"], "backend engineer"],
    ["full-time or contract writer", ["full_time", "contract"], "or writer"],
];
for (const [q, employmentTypes, residualQ] of cases) {
    test(`employment: ${q}`, () => assert.deepEqual(parseEmploymentTypeTokens(q), { residualQ, employmentTypes }));
}

test("every value it can emit is a real facet value", () => {
    const all = parseEmploymentTypeTokens("part time contract internship full time").employmentTypes;
    assert.deepEqual(all, [...EMPLOYMENT_TYPES]);
});

test("not an arrangement: Contract Manager, internal, international, temporary, quoted", () => {
    for (const q of ["Contract Manager", "contract management lead", "internal tools engineer", "international sales", "temporary cashier", '"part time" analyst']) {
        assert.deepEqual(parseEmploymentTypeTokens(q), { residualQ: q, employmentTypes: [] });
    }
});

test("through applyQueryUnderstanding: facet set, other facets kept, explicit selection wins", async () => {
    const out = await applyQueryUnderstanding({ q: "contract data analyst", facets: { work_type: ["remote"] } });
    assert.deepEqual([out.q, out.facets], ["data analyst", { work_type: ["remote"], employment_type: ["contract"] }]);
    const p = { q: "contract data analyst", facets: { employment_type: ["full_time"] } };
    assert.equal(await applyQueryUnderstanding(p), p);
});
