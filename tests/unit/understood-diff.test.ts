import test from "node:test";
import assert from "node:assert/strict";
import { diffUnderstood, mergeUnderstood, understoodLine, understoodSource } from "@/lib/jobs/understood";
import { PRISTINE_FILTER_STATE } from "@/components/jobs/FilterPanel";
import { unmatchedPlaceNote } from "@/lib/jobs/result-state";
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

test("mergeUnderstood fills unset fields and never overwrites a set one", () => {
    const heard = { facets: { work_type: ["remote"], location_country: ["Canada"] }, salaryMin: 150, postedBucket: "7d" as const };
    const fresh = mergeUnderstood(PRISTINE_FILTER_STATE, heard);
    assert.deepEqual(fresh.facets, heard.facets);
    assert.equal(fresh.salaryMin, 150);
    assert.deepEqual([fresh.postedBucket, fresh.postedExplicit], ["7d", true]);

    const chosen = { ...PRISTINE_FILTER_STATE, facets: { work_type: ["hybrid"] }, salaryMin: 90, postedBucket: "30d" as const, postedExplicit: true };
    const merged = mergeUnderstood(chosen, heard);
    assert.deepEqual(merged.facets, { work_type: ["hybrid"], location_country: ["Canada"] });
    assert.deepEqual([merged.salaryMin, merged.postedBucket], [90, "30d"]);
});

test("mergeUnderstood returns the same object when nothing is writable (the loop guard)", () => {
    const state = { ...PRISTINE_FILTER_STATE, facets: { work_type: ["hybrid"] } };
    assert.equal(mergeUnderstood(state, { facets: { work_type: ["remote"] } }), state);
    assert.equal(mergeUnderstood(state, {}), state);
});

test("understoodLine words the added chips like the chips and tolerates an empty residual", () => {
    const chip = (e: { label: string }) => e.label;
    assert.equal(understoodLine("senior pm", [{ key: "work_type:remote", label: "Remote" }, { key: "salaryMin", label: "$150k+" }], chip), "Searched “senior pm” · Remote · $150k+");
    assert.equal(understoodLine(" ", [{ key: "visaOnly", label: "Sponsors visas" }], chip), "Searched all roles · Sponsors visas");
});

test("unmatchedPlaceNote: places only / fragments only / both / none", () => {
    assert.match(unmatchedPlaceNote(["Atlantis"], undefined) ?? "", /^We have no roles in "Atlantis"/);
    assert.match(unmatchedPlaceNote(undefined, ["no crypto"]) ?? "", /^We couldn't apply "no crypto"/);
    const both = unmatchedPlaceNote(["Atlantis"], ["no crypto"]) ?? "";
    assert.ok(both.includes("Atlantis") && both.includes("no crypto"));
    assert.equal(unmatchedPlaceNote(undefined, undefined), null);
    assert.equal(unmatchedPlaceNote([], []), null);
});
