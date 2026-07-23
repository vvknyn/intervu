import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildSearchBody,
    PRECISION_SEARCH_ATTRIBUTES,
    shouldAttemptWidePass,
    shouldWidenSearch,
    WIDE_PASS_LATENCY_BUDGET_MS,
    WIDEN_THRESHOLD,
} from "../../src/lib/jobs/meilisearch";

test("buildSearchBody omits attributesToSearchOn by default", () => {
    const body = buildSearchBody({ q: "marketing" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
});

test("buildSearchBody includes attributesToSearchOn when passed", () => {
    const body = buildSearchBody({ q: "marketing" }, false, PRECISION_SEARCH_ATTRIBUTES);
    assert.deepEqual(body.attributesToSearchOn, ["title", "company"]);
});

test("precision pass fields are title and company only (tags is sparse — measured 2026-07-21)", () => {
    assert.deepEqual([...PRECISION_SEARCH_ATTRIBUTES], ["title", "company"]);
});

test("widen only when a query exists and pass 1 is thin", () => {
    assert.equal(shouldWidenSearch(0, "marketing"), true);
    assert.equal(shouldWidenSearch(WIDEN_THRESHOLD - 1, "marketing"), true);
    assert.equal(shouldWidenSearch(WIDEN_THRESHOLD, "marketing"), false);
    assert.equal(shouldWidenSearch(0, ""), false);
    assert.equal(shouldWidenSearch(0, "   "), false);
});

test("attempt the wide pass only when thin AND pass 1 was fast enough (2026-07-24 incident)", () => {
    // fast + thin → widen
    assert.equal(shouldAttemptWidePass(100, 0, "marketing"), true);
    // slow + thin → pass 1 already ate the latency budget, stay thin
    assert.equal(shouldAttemptWidePass(WIDE_PASS_LATENCY_BUDGET_MS + 1, 0, "marketing"), false);
    // fast + not thin → no need to widen regardless of speed
    assert.equal(shouldAttemptWidePass(100, WIDEN_THRESHOLD, "marketing"), false);
    // exactly at the budget boundary → still allowed (<=)
    assert.equal(shouldAttemptWidePass(WIDE_PASS_LATENCY_BUDGET_MS, 0, "marketing"), true);
    // empty query → never widen, regardless of speed
    assert.equal(shouldAttemptWidePass(100, 0, ""), false);
});
