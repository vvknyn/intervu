import { test } from "node:test";
import assert from "node:assert/strict";
import {
    roleTitlePairQueries,
    shouldRunRoleTitleLane,
    titleSatisfiesRoleQuery,
} from "../../src/lib/jobs/query-understanding";
import {
    applyRelevanceQualityReranking,
    mergeRoleTitleHits,
} from "../../src/lib/jobs/meilisearch";
import { titleRelevanceScore } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

const BRAND_PRODUCT_Q = "director of brand and product";

test("roleTitlePairQueries: director of brand and product → director brand, director product", () => {
    const pairs = roleTitlePairQueries(BRAND_PRODUCT_Q);
    assert.ok(pairs.includes("director brand"));
    assert.ok(pairs.includes("director product"));
    assert.ok(pairs.length <= 3);
    assert.ok(!pairs.some((p) => p.includes("director of")));
});

test("roleTitlePairQueries: ampersand normalizes like and", () => {
    const pairs = roleTitlePairQueries("director of brand & product");
    assert.ok(pairs.includes("director brand"));
    assert.ok(pairs.includes("director product"));
});

test("roleTitlePairQueries: lone director → []", () => {
    assert.deepEqual(roleTitlePairQueries("director"), []);
});

test("roleTitlePairQueries: stripe (no seniority) → []", () => {
    assert.deepEqual(roleTitlePairQueries("stripe"), []);
});

test("roleTitlePairQueries: rust (no seniority phrase) → []", () => {
    assert.deepEqual(roleTitlePairQueries("rust"), []);
});

test("shouldRunRoleTitleLane: false for tech skill, companyScoped, offset>0", () => {
    assert.equal(shouldRunRoleTitleLane("rust", false, 0), false);
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, true, 0), false);
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, false, 20), false);
});

test("shouldRunRoleTitleLane: true for brand/product director at offset 0", () => {
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, false, 0), true);
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, false, undefined), true);
});

test("mergeRoleTitleHits: extra id present, duplicates not doubled, primary order preserved", () => {
    const primaryHit = { id: "a", title: "A" } as PublicJob;
    const primaryHit2 = { id: "b", title: "B" } as PublicJob;
    const extraHit = { id: "c", title: "C" } as PublicJob;
    const duplicateExtra = { id: "a", title: "A dup" } as PublicJob;

    const merged = mergeRoleTitleHits(
        { hits: [primaryHit, primaryHit2], total: 100 },
        [extraHit, duplicateExtra],
    );

    assert.equal(merged.total, 100);
    assert.deepEqual(merged.hits.map((h) => h.id), ["a", "b", "c"]);
    assert.equal(merged.hits.length, 3);
});

test("applyRelevanceQualityReranking: Brand Director extra outranks Product Data Coordinator primary", () => {
    const brandDirector = {
        id: "brand-dir",
        title: "Director of Brand & Product Design",
        salary_min: null,
        salary_max: null,
        ghost_badge: "unscored",
        posted_ts: 1000,
    } as PublicJob;
    const coordinator = {
        id: "coordinator",
        title: "Product Data Coordinator",
        salary_min: null,
        salary_max: null,
        ghost_badge: "unscored",
        posted_ts: 2000,
    } as PublicJob;

    assert.ok(
        titleRelevanceScore(brandDirector.title, BRAND_PRODUCT_Q) >
            titleRelevanceScore(coordinator.title, BRAND_PRODUCT_Q),
    );

    const merged = mergeRoleTitleHits(
        { hits: [coordinator], total: 50 },
        [brandDirector],
    );
    const ranked = applyRelevanceQualityReranking(merged.hits, BRAND_PRODUCT_Q);
    assert.equal(ranked[0].id, "brand-dir");
});

test("titleSatisfiesRoleQuery: keeps director+product and director+brand titles", () => {
    assert.equal(titleSatisfiesRoleQuery("Director, Product Management", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Director, Brand Strategy", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Director of Brand & Product Design", BRAND_PRODUCT_Q), true);
});

test("titleSatisfiesRoleQuery: drops one-token and false-friend titles", () => {
    assert.equal(titleSatisfiesRoleQuery("Brand Designer", BRAND_PRODUCT_Q), false);
    assert.equal(titleSatisfiesRoleQuery("Account Director", BRAND_PRODUCT_Q), false);
    assert.equal(titleSatisfiesRoleQuery("Director, People & Culture", BRAND_PRODUCT_Q), false);
    assert.equal(titleSatisfiesRoleQuery("Senior Art Director", BRAND_PRODUCT_Q), false);
    assert.equal(titleSatisfiesRoleQuery("Director of Production- Contract Role", BRAND_PRODUCT_Q), false);
});

test("titleSatisfiesRoleQuery: does not floor queries without a seniority+role pair", () => {
    assert.equal(titleSatisfiesRoleQuery("Staff Engineer", "stripe"), true);
    assert.equal(titleSatisfiesRoleQuery("Therapist", "rust"), true);
});

test("role-query page: one-token titles are filtered after rerank", () => {
    const keep = {
        id: "keep",
        title: "Director, Product Management",
        salary_min: 100000,
        ghost_badge: "unscored",
        posted_ts: 1,
    } as PublicJob;
    const drop = {
        id: "drop",
        title: "Brand Designer",
        salary_min: 80000,
        ghost_badge: "unscored",
        posted_ts: 2,
    } as PublicJob;
    const ranked = applyRelevanceQualityReranking([keep, drop], BRAND_PRODUCT_Q).filter((h) =>
        titleSatisfiesRoleQuery(h.title, BRAND_PRODUCT_Q),
    );
    assert.deepEqual(ranked.map((h) => h.id), ["keep"]);
});
