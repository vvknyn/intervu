import test from "node:test";
import assert from "node:assert/strict";
import { diffUnderstood, understoodSource } from "@/lib/jobs/understood";
import type { JobSearchParams } from "@/lib/jobs/types";

const canada = { any: [{ field: "location_country" as const, value: "Canada" }], workTypes: ["remote"], label: "Canada" };

test("nothing set by the stages -> undefined", () => {
    const p: JobSearchParams = { q: "nurse", facets: { work_type: ["remote"] }, salaryMin: 100 };
    assert.equal(diffUnderstood(p, { ...p }, "deterministic"), undefined);
});

test("fields the caller sent are never echoed back", () => {
    const raw: JobSearchParams = { q: "pm", facets: { work_type: ["hybrid"] }, postedBucket: "7d" };
    const after: JobSearchParams = { q: "pm", facets: { work_type: ["hybrid"] }, postedBucket: "7d", places: [canada] };
    const out = diffUnderstood(raw, after, "deterministic");
    assert.deepEqual(out?.params, { facets: { location_country: ["Canada"] } });
});

test("a place read from text becomes a location facet plus its bound work mode", () => {
    const out = diffUnderstood({ q: "senior pm remote canada" }, { q: "senior pm", places: [canada] }, "deterministic");
    assert.deepEqual(out, {
        params: { facets: { location_country: ["Canada"], work_type: ["remote"] } },
        residualQ: "senior pm",
        source: "deterministic",
    });
});

test("scalar fields set by a stage are echoed (a different class of field than places)", () => {
    const out = diffUnderstood(
        { q: "dev paying 150k posted this week" },
        { q: "dev", salaryMin: 150, postedBucket: "7d", yearsExperience: "3-5" as never, facets: { employment_type: ["full_time"] } },
        "llm",
    );
    assert.deepEqual(out?.params, { facets: { employment_type: ["full_time"] }, salaryMin: 150, postedBucket: "7d", yearsExperience: "3-5" });
    assert.equal(out?.source, "llm");
});

test("understoodSource: llm only when the llm stage changed the params", () => {
    const a: JobSearchParams = { q: "x" };
    assert.equal(understoodSource(a, { ...a }), "deterministic");
    assert.equal(understoodSource(a, { ...a, salaryMin: 1 }), "llm");
});
