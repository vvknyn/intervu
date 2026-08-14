import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, shouldRelaxSearch } from "../../src/lib/jobs/meilisearch";

test("by default the search body does not restrict attributesToSearchOn — the whole posting is one document", () => {
    // The old title/company precision pass treated place words as title words:
    // "product manager canada" found only the 24 roles literally TITLED that,
    // while 23,813 postings matched all three words somewhere (measured live
    // 2026-07-26). Title-first ranking survives via `searchableAttributes`
    // order, not via restricting where words may match.
    const body = buildSearchBody({ q: "product manager canada" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
    // ...and an explicit non-company query stays unrestricted too.
    const notScoped = buildSearchBody({ q: "product manager canada" }, false, "all", { companyScoped: false });
    assert.ok(!("attributesToSearchOn" in notScoped), JSON.stringify(notScoped));
});

test("a company-name query scopes retrieval to the company attribute", () => {
    // The ONE exception, and only when company-intent.ts has corroborated the
    // query against the corpus — this is what preserves company precision
    // independently of the `exactness` ranking rule.
    const body = buildSearchBody({ q: "cloudflare" }, false, "all", { companyScoped: true });
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
    assert.equal(body.q, "cloudflare");
    assert.equal(body.matchingStrategy, "all");
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

test("an explicit newest sort with a query scopes retrieval to title+company", () => {
    // The bug this exists to prevent: q="product manager" + FRESHEST surfaced
    // "Driver - Class 5" — a fresh posting whose only match was buried in its
    // description — because an explicit `sort` now acts as a global ORDER BY.
    const body = buildSearchBody({ q: "product manager", sort: "newest" }, false);
    assert.deepEqual(body.attributesToSearchOn, ["title", "company"]);
});

test("an explicit salary_desc sort with a query scopes retrieval to title+company", () => {
    const body = buildSearchBody({ q: "product manager", sort: "salary_desc" }, false);
    assert.deepEqual(body.attributesToSearchOn, ["title", "company"]);
});

test("relevance sort (explicit or auto) with a query stays unscoped", () => {
    const explicit = buildSearchBody({ q: "product manager", sort: "relevance" }, false);
    assert.ok(!("attributesToSearchOn" in explicit), JSON.stringify(explicit));
    const auto = buildSearchBody({ q: "product manager" }, false);
    assert.ok(!("attributesToSearchOn" in auto), JSON.stringify(auto));
});

test("browse mode (no query) stays unscoped regardless of sort", () => {
    const newest = buildSearchBody({ sort: "newest" }, false);
    assert.ok(!("attributesToSearchOn" in newest), JSON.stringify(newest));
    const salary = buildSearchBody({ sort: "salary_desc" }, false);
    assert.ok(!("attributesToSearchOn" in salary), JSON.stringify(salary));
});

test("company-intent scoping is narrower and always wins over sort-scoping", () => {
    const body = buildSearchBody({ q: "cloudflare", sort: "newest" }, false, "all", { companyScoped: true });
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
});

test("the relax pass (matchingStrategy last) drops sort-scoping back to whole-document search", () => {
    const strict = buildSearchBody({ q: "product manager", sort: "newest" }, false, "all");
    assert.deepEqual(strict.attributesToSearchOn, ["title", "company"]);
    const relaxed = buildSearchBody({ q: "product manager", sort: "newest" }, false, "last");
    assert.ok(!("attributesToSearchOn" in relaxed), JSON.stringify(relaxed));
});
