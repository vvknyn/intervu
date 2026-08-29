import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildSearchBody,
    JOB_LIST_ATTRIBUTES_TO_RETRIEVE,
    JOBS_INDEX_SETTINGS,
    mergeExpandedIntoStrict,
    quoteShortTokens,
    shouldRelaxSearch,
} from "../../src/lib/jobs/meilisearch";
import type { JobSearchResult, PublicJob } from "../../src/lib/jobs/types";

const SORT_MODES = [undefined, "relevance", "newest", "salary_desc"] as const;
const Q = "product manager";
const FACETS = { experience_level: ["senior"] as string[] };

function omitSort(body: ReturnType<typeof buildSearchBody>) {
    const { sort: _sort, ...rest } = body;
    return rest;
}

test("default SERP retrieval is whole-document — no title-first attributesToSearchOn", () => {
    const body = buildSearchBody({ q: "product manager canada" }, false);
    assert.ok(!("attributesToSearchOn" in body), JSON.stringify(body));
});

test("the expand pass drops attribute scoping back to whole-document search", () => {
    const strict = buildSearchBody({ q: "product manager canada" }, false, "all");
    assert.ok(!("attributesToSearchOn" in strict));
    const expanded = buildSearchBody({ q: "product manager canada" }, false, "all", { wholeDocument: true });
    assert.ok(!("attributesToSearchOn" in expanded));
    assert.equal(expanded.matchingStrategy, "all");
});

test("a company-name query scopes retrieval to the company attribute", () => {
    const body = buildSearchBody({ q: "cloudflare" }, false, "all", { companyScoped: true });
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
    assert.equal(body.q, "cloudflare");
    assert.equal(body.matchingStrategy, "all");
});

test("strict matching is the default — every query word must match", () => {
    assert.equal(buildSearchBody({ q: "technical account manager" }, false).matchingStrategy, "all");
});

test("expand pass keeps matchingStrategy all — never last", () => {
    assert.equal(buildSearchBody({ q: "x" }, false, "all", { wholeDocument: true }).matchingStrategy, "all");
});

test("relax fires only on a true query miss — zero hits, not thin pages", () => {
    assert.equal(shouldRelaxSearch(0, "quantum optics researcher lisbon"), true);
    assert.equal(shouldRelaxSearch(2, "quantum optics researcher lisbon"), false, "2 hits must NOT relax");
    assert.equal(shouldRelaxSearch(3, "quantum optics researcher lisbon"), false);
    assert.equal(shouldRelaxSearch(19, "quantum optics researcher lisbon"), false);
    assert.equal(shouldRelaxSearch(20, "quantum optics researcher lisbon"), false);
    assert.equal(shouldRelaxSearch(0, ""), false, "a browse is already wide — nothing to relax");
    assert.equal(shouldRelaxSearch(0, "   "), false);
});

test("mergeExpandedIntoStrict unions strict hits then extras and sets widened only with extras", () => {
    const strict = {
        hits: [{ id: "a", title: "A" } as PublicJob],
        total: 1,
        backend: "meilisearch",
        configured: true,
    } satisfies JobSearchResult;
    const expanded = {
        hits: [
            { id: "a", title: "A" } as PublicJob,
            { id: "b", title: "B" } as PublicJob,
        ],
        total: 2,
        backend: "meilisearch",
        configured: true,
    } satisfies JobSearchResult;
    const merged = mergeExpandedIntoStrict(strict, expanded);
    assert.deepEqual(merged.hits.map((h) => h.id), ["a", "b"]);
    assert.equal(merged.widened, true);
    assert.equal(mergeExpandedIntoStrict(strict, { ...expanded, hits: [expanded.hits[0]] }).widened, undefined);
});

test("explicit newest and salary_desc sorts with a query stay whole-document", () => {
    const relevance = buildSearchBody({ q: Q }, false);
    assert.ok(!("attributesToSearchOn" in relevance));
    for (const sort of ["newest", "salary_desc"] as const) {
        const body = buildSearchBody({ q: Q, sort }, false);
        assert.ok(!("attributesToSearchOn" in body), `${sort}: ${JSON.stringify(body)}`);
    }
});

test("relevance sort (explicit or auto) with a query stays whole-document", () => {
    const explicit = buildSearchBody({ q: Q, sort: "relevance" }, false);
    assert.ok(!("attributesToSearchOn" in explicit), JSON.stringify(explicit));
    const auto = buildSearchBody({ q: Q }, false);
    assert.ok(!("attributesToSearchOn" in auto), JSON.stringify(auto));
});

test("browse mode (no query) stays unscoped regardless of sort", () => {
    const newest = buildSearchBody({ sort: "newest" }, false);
    assert.ok(!("attributesToSearchOn" in newest), JSON.stringify(newest));
    const salary = buildSearchBody({ sort: "salary_desc" }, false);
    assert.ok(!("attributesToSearchOn" in salary), JSON.stringify(salary));
});

test("company-intent scoping is narrower and always wins over sort", () => {
    const body = buildSearchBody({ q: "cloudflare", sort: "newest" }, false, "all", { companyScoped: true });
    assert.deepEqual(body.attributesToSearchOn, ["company"]);
});

test("the expand pass drops tech-skill scoping back to whole-document search", () => {
    const strict = buildSearchBody({ q: "Rust", sort: "newest" }, false, "all");
    assert.deepEqual(strict.attributesToSearchOn, ["title", "tags", "description"]);
    const expanded = buildSearchBody({ q: "Rust", sort: "newest" }, false, "all", { wholeDocument: true });
    assert.ok(!("attributesToSearchOn" in expanded), JSON.stringify(expanded));
    assert.equal(expanded.matchingStrategy, "all");
});

test("same q produces identical attributesToSearchOn across all sort modes", () => {
    const bodies = SORT_MODES.map((sort) =>
        omitSort(buildSearchBody(sort ? { q: Q, sort } : { q: Q }, false)),
    );
    for (let i = 1; i < bodies.length; i++) {
        assert.deepEqual(bodies[i], bodies[0], `sort mode ${SORT_MODES[i]} diverged from baseline`);
    }
});

test("same q + facets produce identical filter across all sort modes", () => {
    const filters = SORT_MODES.map((sort) =>
        buildSearchBody(sort ? { q: Q, facets: FACETS, sort } : { q: Q, facets: FACETS }, false).filter,
    );
    for (let i = 1; i < filters.length; i++) {
        assert.deepEqual(filters[i], filters[0], `sort mode ${SORT_MODES[i]} filter diverged`);
    }
    for (const f of filters) {
        assert.ok(!f.some((c) => c.includes("sort")));
    }
});

test("tech-skill query scopes identically for relevance and newest", () => {
    const relevance = buildSearchBody({ q: "Rust", sort: "relevance" }, false);
    const newest = buildSearchBody({ q: "Rust", sort: "newest" }, false);
    assert.deepEqual(relevance.attributesToSearchOn, ["title", "tags", "description"]);
    assert.deepEqual(newest.attributesToSearchOn, relevance.attributesToSearchOn);
});

test("Staff Engineer query: relevance and newest share matching fields", () => {
    const relevance = buildSearchBody({ q: "Staff Engineer", sort: "relevance" }, false);
    const newest = buildSearchBody({ q: "Staff Engineer", sort: "newest" }, false);
    assert.deepEqual(
        "attributesToSearchOn" in relevance ? relevance.attributesToSearchOn : undefined,
        "attributesToSearchOn" in newest ? newest.attributesToSearchOn : undefined,
    );
});

test("quoteShortTokens wraps tokens below the typo-tolerance floor in phrase quotes", () => {
    assert.equal(quoteShortTokens("tam"), '"tam"');
    assert.equal(quoteShortTokens("pm"), '"pm"');
    assert.equal(quoteShortTokens("qa"), '"qa"');
});

test("a token exactly AT the typo-tolerance floor keeps prefix+typo behaviour — not quoted", () => {
    assert.equal(quoteShortTokens("scrum"), "scrum");
});

test("a token one below the floor is quoted", () => {
    assert.equal(quoteShortTokens("scrm"), '"scrm"');
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

test("quoteShortTokens fails safe to unquoted when the threshold is unavailable", () => {
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

test("buildSearchBody quotes short tokens in the submitted search q", () => {
    assert.equal(buildSearchBody({ q: "tam" }, false).q, '"tam"');
    assert.equal(buildSearchBody({ q: "pm" }, false).q, '"pm"');
    assert.equal(buildSearchBody({ q: "qa" }, false).q, '"qa"');
    assert.equal(buildSearchBody({ q: "engineer" }, false).q, "engineer");
    assert.equal(buildSearchBody({ q: "technical account manager" }, false).q, "technical account manager");
});

test("list search uses limit/offset pagination, not hitsPerPage/page", () => {
    const body = buildSearchBody({ q: Q, limit: 20, offset: 40 }, false);
    assert.equal(body.limit, 20);
    assert.equal(body.offset, 40);
    assert.ok(!("hitsPerPage" in body));
    assert.ok(!("page" in body));
});

test("list search retrieves JOB_LIST_ATTRIBUTES_TO_RETRIEVE without description", () => {
    const body = buildSearchBody({ q: Q }, false);
    assert.ok(body.attributesToRetrieve);
    assert.deepEqual(body.attributesToRetrieve, [...JOB_LIST_ATTRIBUTES_TO_RETRIEVE]);
    assert.ok(!(body.attributesToRetrieve as readonly string[]).includes("description"));
});

test("JOB_LIST_ATTRIBUTES_TO_RETRIEVE carries exactly the enriched fields the SERP reads, no more", () => {
    const attrs = JOB_LIST_ATTRIBUTES_TO_RETRIEVE as readonly string[];
    for (const read of ["min_years_experience", "must_have_skills", "tech_stack"]) {
        assert.ok(attrs.includes(read), `expected ${read} in retrieve list: ${JSON.stringify(attrs)}`);
    }
    for (const unread of [
        "max_years_experience",
        "preferred_skills",
        "in_office_days",
        "normalized_salary_min",
        "normalized_salary_max",
    ]) {
        assert.ok(!attrs.includes(unread), `${unread} has no reader — should not be retrieved: ${JSON.stringify(attrs)}`);
    }
});

test("id lookup omits attributesToRetrieve so the full document is returned", () => {
    const body = buildSearchBody({ id: "abc", limit: 1 }, false);
    assert.ok(!("attributesToRetrieve" in body));
});

test("JOBS_INDEX_SETTINGS declares the 15 stopWords live on the jobs index", () => {
    assert.deepEqual(JOBS_INDEX_SETTINGS.stopWords, [
        "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
    ]);
});
