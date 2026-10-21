import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLlmUnderstanding } from "../../src/lib/jobs/llm-understanding";
import { createLruCache, type ParseDeps } from "../../src/lib/jobs/llm-understanding/parse";
import type { LocationVocabulary } from "../../src/lib/jobs/query-understanding";
import type { LadderRung } from "../../src/lib/llm/model-ladder";

const rungs: LadderRung[] = [{ model: "a", timeoutMs: 1, isFallback: false }, { model: "paid", timeoutMs: 1, isFallback: true }];
function parse(reply: () => string): ParseDeps & { calls: number } {
    const d = { calls: 0, rungs, cache: createLruCache(5), generate: async () => { d.calls++; return reply(); } };
    return d;
}
const vocab = {
    corpusChecker: async (batches: { field: string; value: string }[][]) =>
        batches.map((b) => b.filter((x) => x.value === "Toronto" && x.field === "location_city").map(({ field, value }) => ({ field, value }))),
} as unknown as LocationVocabulary;

test("a multi-word residual is parsed and applied", async () => {
    const d = parse(() => JSON.stringify({ titles: ["data analyst"], employment_type: "contract", min_salary: { amount: 90000, currency: "USD" } }));
    const out = await applyLlmUnderstanding({ q: "contract data analyst over 90k" }, { parse: d });
    assert.equal(out.q, "data analyst");
    assert.deepEqual(out.facets?.employment_type, ["contract"]);
    assert.equal(out.salaryMin, 90000);
});

test("gate: a single word with no digit never reaches the model", async () => {
    const d = parse(() => "{}");
    for (const q of ["engineer", "", "  "]) {
        const p = { q };
        assert.equal(await applyLlmUnderstanding(p, { parse: d }), p);
    }
    assert.equal(d.calls, 0);
});

test("gate: a single token with a digit is parsed", async () => {
    const d = parse(() => JSON.stringify({ min_salary: { amount: 200000, currency: null } }));
    assert.equal((await applyLlmUnderstanding({ q: "200k" }, { parse: d })).salaryMin, 200000);
});

test("gate: quoted-OR title lists and single-job lookups are left alone", async () => {
    const d = parse(() => "{}");
    const pack = { q: '"A b" OR "C d"' };
    assert.equal(await applyLlmUnderstanding(pack, { parse: d }), pack);
    const byId = { q: "two words", id: "x" };
    assert.equal(await applyLlmUnderstanding(byId, { parse: d }), byId);
    assert.equal(d.calls, 0);
});

test("every rung failing returns the params untouched", async () => {
    const d = parse(() => { throw new Error("429"); });
    const p = { q: "two words" };
    assert.equal(await applyLlmUnderstanding(p, { parse: d }), p);
});

test("an empty parse never wipes the query", async () => {
    const p = { q: "two words" };
    assert.equal(await applyLlmUnderstanding(p, { parse: parse(() => "{}") }), p);
});

test("a location the corpus knows becomes a place clause; one it lacks becomes a mention", async () => {
    const known = await applyLlmUnderstanding({ q: "x y" }, { parse: parse(() => JSON.stringify({ titles: ["x y"], location: { city: "Toronto" } })), vocab });
    assert.deepEqual(known.places, [{ any: [{ field: "location_city", value: "Toronto" }] }]);
    const lost = await applyLlmUnderstanding({ q: "x y" }, { parse: parse(() => JSON.stringify({ titles: ["x y"], location: { city: "Atlantis" } })), vocab });
    assert.equal(lost.places, undefined);
    assert.deepEqual(lost.unmatchedQueryMentions, ["Atlantis"]);
});
