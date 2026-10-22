import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSalaryTokens } from "../../src/lib/jobs/query-tokens/salary";
import { applyQueryUnderstanding } from "../../src/lib/jobs/query-understanding";

const cases: [string, number, string][] = [
    ["product owner over 150k CAD", 150000, "product owner"],
    ["data engineer, 180k+", 180000, "data engineer"],
    ["director of engineering, at least 250k usd, new york", 250000, "director of engineering, new york"],
    ["devops sre terraform aws 200k", 200000, "devops sre terraform aws"],
    ["technical writer, api docs, 90k gbp minimum", 90000, "technical writer, api docs"],
    ["designer $120,000", 120000, "designer"],
    ["analyst 150,000", 150000, "analyst"],
    ["pm min $95k", 95000, "pm"],
    ["engineer 85.5k", 85500, "engineer"],
];
for (const [q, salaryMin, residualQ] of cases) {
    test(`salary: ${q}`, () => assert.deepEqual(parseSalaryTokens(q), { residualQ, salaryMin }));
}

test("a bare number without k, symbol or comma grouping is not a salary", () => {
    for (const q of ["engineer 2024", "go 1500", "level 5 engineer", "3 days in office", "$150 gift", "kubernetes 150 k8s"]) {
        assert.deepEqual(parseSalaryTokens(q), { residualQ: q });
    }
});

test("401k is a benefit, not a salary; word boundaries hold", () => {
    assert.deepEqual(parseSalaryTokens("401k match engineer"), { residualQ: "401k match engineer" });
    assert.deepEqual(parseSalaryTokens("k150k engineer"), { residualQ: "k150k engineer" });
    assert.deepEqual(parseSalaryTokens("150kg"), { residualQ: "150kg" });
});

test("a quoted phrase is never consumed", () => {
    assert.deepEqual(parseSalaryTokens('"150k club" engineer'), { residualQ: '"150k club" engineer' });
    assert.deepEqual(parseSalaryTokens('"150k club" engineer 90k'), { residualQ: '"150k club" engineer', salaryMin: 90000 });
});

test("only the first amount is the floor; the rest stay in the query", () => {
    assert.deepEqual(parseSalaryTokens("engineer 100k 200k"), { residualQ: "engineer 200k", salaryMin: 100000 });
});

test("through applyQueryUnderstanding: typed 150k sets salaryMin and leaves the title", async () => {
    const out = await applyQueryUnderstanding({ q: "Product Manager over 150k CAD" });
    assert.equal(out.q, "Product Manager");
    assert.equal(out.salaryMin, 150000);
});

test("an explicit salaryMin is never overwritten and the typed words stay", async () => {
    const p = { q: "Product Manager 150k", salaryMin: 90000 };
    assert.equal(await applyQueryUnderstanding(p), p);
});
