import { test } from "node:test";
import assert from "node:assert/strict";
import { applyQueryUnderstanding, parseWorkTypeTokens } from "../../src/lib/jobs/query-understanding";

test("extracts remote and leaves the role residue", () => {
    assert.deepEqual(parseWorkTypeTokens("backend engineer remote"), {
        residualQ: "backend engineer",
        workTypes: ["remote"],
    });
});

test("bare token query leaves an empty residue", () => {
    assert.deepEqual(parseWorkTypeTokens("remote"), { residualQ: "", workTypes: ["remote"] });
});

test("phrases: work from home, on-site, in office, wfh", () => {
    assert.deepEqual(parseWorkTypeTokens("work from home nurse").workTypes, ["remote"]);
    assert.deepEqual(parseWorkTypeTokens("on-site technician").workTypes, ["onsite"]);
    assert.deepEqual(parseWorkTypeTokens("in office assistant").workTypes, ["onsite"]);
    assert.deepEqual(parseWorkTypeTokens("wfh data entry").workTypes, ["remote"]);
});

test("word boundaries: 'remotely' is not a token", () => {
    assert.deepEqual(parseWorkTypeTokens("remotely operated vehicle engineer").workTypes, []);
});

test("case-insensitive, whitespace collapsed", () => {
    assert.deepEqual(parseWorkTypeTokens("  Hybrid   Product Manager "), {
        residualQ: "Product Manager",
        workTypes: ["hybrid"],
    });
});

test("no tokens → params unchanged (same object)", () => {
    const p = { q: "staff engineer" };
    assert.equal(applyQueryUnderstanding(p), p);
});

test("applies parsed work_type as a facet and strips the token", () => {
    assert.deepEqual(applyQueryUnderstanding({ q: "backend engineer remote" }), {
        q: "backend engineer",
        facets: { work_type: ["remote"] },
    });
});

test("explicit UI facet always wins — parse never overrides", () => {
    const p = { q: "backend engineer remote", facets: { work_type: ["hybrid"] } };
    assert.equal(applyQueryUnderstanding(p), p);
});

test("empty query passes through", () => {
    const p = { q: "" };
    assert.equal(applyQueryUnderstanding(p), p);
});
