import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, JOBS_INDEX_SETTINGS, quoteShortTokens, shouldRelaxSearch } from "../../src/lib/jobs/meilisearch";

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

test("an explicit newest sort with a query stays whole-document — same retrieval as relevance", () => {
    const body = buildSearchBody({ q: "product manager", sort: "newest" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
    assert.deepEqual(body.sort, ["posted_ts:desc"]);
});

test("an explicit salary_desc sort with a query stays whole-document", () => {
    const body = buildSearchBody({ q: "product manager", sort: "salary_desc" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
    assert.deepEqual(body.sort, ["salary_max:desc", "salary_min:desc"]);
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

test("company-intent scoping wins regardless of sort", () => {
    const body = buildSearchBody({ q: "cloudflare", sort: "newest" }, false, "all", { companyScoped: true });
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
});

test("the relax pass (matchingStrategy last) drops tech-skill scoping back to whole-document search", () => {
    const strictRole = buildSearchBody({ q: "product manager", sort: "newest" }, false, "all");
    assert.ok(!("attributesToSearchOn" in strictRole), JSON.stringify(strictRole));
    const relaxedRole = buildSearchBody({ q: "product manager", sort: "newest" }, false, "last");
    assert.ok(!("attributesToSearchOn" in relaxedRole), JSON.stringify(relaxedRole));
    assert.equal(relaxedRole.matchingStrategy, "last");

    const strictTech = buildSearchBody({ q: "Rust", sort: "newest" }, false, "all");
    assert.deepEqual(strictTech.attributesToSearchOn, ["title", "tags", "description"]);
    const relaxedTech = buildSearchBody({ q: "Rust", sort: "newest" }, false, "last");
    assert.ok(!("attributesToSearchOn" in relaxedTech), JSON.stringify(relaxedTech));
});

test("sort does not change which attributes are searched — same q, different sorts, identical retrieval scope", () => {
    const q = "product manager";
    const base = { q, matchingStrategy: "all" as const, filter: buildSearchBody({ q }, false).filter };
    const newest = buildSearchBody({ q, sort: "newest" }, false);
    const relevance = buildSearchBody({ q, sort: "relevance" }, false);
    const salary = buildSearchBody({ q, sort: "salary_desc" }, false);
    const auto = buildSearchBody({ q }, false);

    for (const body of [newest, relevance, salary, auto]) {
        assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
        assert.equal(body.q, q);
        assert.equal(body.matchingStrategy, base.matchingStrategy);
        assert.deepEqual(body.filter, base.filter);
    }
    assert.deepEqual(newest.sort, ["posted_ts:desc"]);
    assert.deepEqual(salary.sort, ["salary_max:desc", "salary_min:desc"]);
    assert.equal(relevance.sort, undefined);
    assert.equal(auto.sort, undefined);
});

test("tech-skill scoping is identical under newest and relevance", () => {
    const scoped = ["title", "tags", "description"] as const;
    const newest = buildSearchBody({ q: "Rust", sort: "newest" }, false);
    const relevance = buildSearchBody({ q: "Rust", sort: "relevance" }, false);
    assert.deepEqual(newest.attributesToSearchOn, [...scoped]);
    assert.deepEqual(relevance.attributesToSearchOn, [...scoped]);
});

// Short-token prefix explosion (meilisearch is index-wide prefixSearch, no
// per-query opt-out on 1.45.2): q=tam returned 22,977 hits live 2026-08-23
// (Tampa, Tamayyaz, ...) vs 1,822 phrase-quoted. Threshold is
// JOBS_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos.oneTypo = 5 — tokens
// below it get no typo tolerance from Meilisearch anyway, so quoting them
// forfeits nothing that was working.
test("quoteShortTokens wraps tokens below the typo-tolerance floor in phrase quotes", () => {
    assert.equal(quoteShortTokens("tam"), '"tam"');
    assert.equal(quoteShortTokens("pm"), '"pm"');
    assert.equal(quoteShortTokens("qa"), '"qa"');
});

test("a token exactly AT the typo-tolerance floor keeps prefix+typo behaviour — not quoted", () => {
    assert.equal(quoteShortTokens("scrum"), "scrum"); // 5 chars == oneTypo threshold
});

test("a token one below the floor is quoted", () => {
    assert.equal(quoteShortTokens("scrm"), '"scrm"'); // 4 chars
});

test("a long token is never quoted", () => {
    assert.equal(quoteShortTokens("engineer"), "engineer");
});

test("a multi-token query quotes only the short tokens, longer ones pass through", () => {
    assert.equal(quoteShortTokens("tam manager"), '"tam" manager');
    assert.equal(quoteShortTokens("qa engineer"), '"qa" engineer');
});

test("an already-quoted phrase is left alone, even if it contains short words", () => {
    assert.equal(quoteShortTokens('"tam"'), '"tam"');
    assert.equal(quoteShortTokens('"technical account manager"'), '"technical account manager"');
});

test("empty query is a no-op", () => {
    assert.equal(quoteShortTokens(""), "");
});

test("quoteShortTokens fails safe to unquoted (current behaviour) when the threshold is unavailable — never a fabricated threshold", () => {
    const minWordSizeForTypos = JOBS_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos as { oneTypo: number | undefined };
    const real = minWordSizeForTypos.oneTypo;
    try {
        minWordSizeForTypos.oneTypo = undefined;
        assert.equal(quoteShortTokens("tam"), "tam");
        assert.equal(quoteShortTokens("engineer"), "engineer");
    } finally {
        minWordSizeForTypos.oneTypo = real;
    }
});

test("buildSearchBody quotes short tokens in the submitted search q; longer tokens are byte-identical", () => {
    assert.equal(buildSearchBody({ q: "tam" }, false).q, '"tam"');
    assert.equal(buildSearchBody({ q: "pm" }, false).q, '"pm"');
    assert.equal(buildSearchBody({ q: "qa" }, false).q, '"qa"');
    assert.equal(buildSearchBody({ q: "engineer" }, false).q, "engineer");
    assert.equal(buildSearchBody({ q: "technical account manager" }, false).q, "technical account manager");
});
