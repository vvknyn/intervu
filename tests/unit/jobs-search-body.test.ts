import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, shouldRelaxSearch } from "../../src/lib/jobs/meilisearch";

test("the search body never restricts attributesToSearchOn — the whole posting is one document", () => {
    // The old title/company precision pass treated place words as title words:
    // "product manager canada" found only the 24 roles literally TITLED that,
    // while 23,813 postings matched all three words somewhere (measured live
    // 2026-07-26). Title-first ranking survives via `searchableAttributes`
    // order, not via restricting where words may match.
    const body = buildSearchBody({ q: "product manager canada" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
});

test("strict matching is the default — every query word must match", () => {
    assert.equal(buildSearchBody({ q: "technical account manager" }, false).matchingStrategy, "all");
});

test("the relax pass can be requested explicitly", () => {
    assert.equal(buildSearchBody({ q: "x" }, false, "last").matchingStrategy, "last");
});

test("relax only when a real query strictly matched NOTHING — thin results stay strict", () => {
    assert.equal(shouldRelaxSearch(0, "quantum optics researcher lisbon"), true);
    // 3 genuine all-word matches must show as 3, never 3 + word-dropped noise.
    assert.equal(shouldRelaxSearch(3, "quantum optics researcher lisbon"), false);
    assert.equal(shouldRelaxSearch(0, ""), false, "a browse is already wide — nothing to relax");
    assert.equal(shouldRelaxSearch(0, "   "), false);
});
