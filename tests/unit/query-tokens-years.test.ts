import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYearsTokens } from "../../src/lib/jobs/query-tokens/years";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";

const cases: [string, string, string][] = [
    ["engineering manager 8+ years, hybrid", "6-10", "engineering manager, hybrid"],
    ["growth pm b2c mobile, 5 years, remote", "3-5", "growth pm b2c mobile, remote"],
    ["designer 3-5 yrs", "3-5", "designer"],
    ["director at least 10 years of experience", "6-10", "director"],
    ["analyst 1 year", "0-2", "analyst"],
    ["architect 12+ years experience", "11+", "architect"],
    ["analyst minimum 2 years", "0-2", "analyst"],
];
for (const [q, yearsExperience, residualQ] of cases) {
    test(`years: ${q}`, () => assert.deepEqual(parseYearsTokens(q), { residualQ, yearsExperience }));
}

test("first-person experience is a mention, never a filter", () => {
    assert.deepEqual(parseYearsTokens("something in product, I have 13 years, remote only please"), {
        residualQ: "something in product, remote only please",
        mentions: ["I have 13 years"],
    });
    assert.deepEqual(parseYearsTokens("I've got 4 years of experience designer"), {
        residualQ: "designer",
        mentions: ["I've got 4 years of experience"],
    });
});

test("not a requirement: 'last 2 years', bare numbers, quoted phrases, 'year' inside a word", () => {
    for (const q of ["posted last 2 years", "level 5 engineer", '"5 years" club', "yearly bonus analyst"]) {
        assert.deepEqual(parseYearsTokens(q), { residualQ: q });
    }
});

test("through applyQueryUnderstanding: filter, mention, and explicit-wins", async () => {
    const out = await applyQueryUnderstanding({ q: "engineering manager 8+ years" });
    assert.deepEqual([out.q, out.yearsExperience], ["engineering manager", "6-10"]);
    const me = await applyQueryUnderstanding({ q: "product lead I have 13 years" });
    assert.deepEqual([me.q, me.yearsExperience, me.unmatchedQueryMentions], ["product lead", undefined, ["I have 13 years"]]);
    const p = { q: "engineering manager 8+ years", yearsExperience: "0-2" as const };
    assert.equal(await applyQueryUnderstanding(p), p);
});
