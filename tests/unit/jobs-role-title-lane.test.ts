import { test } from "node:test";
import assert from "node:assert/strict";
import {
    roleTitlePairQueries,
    shouldRunRoleTitleLane,
    titleSatisfiesRoleQuery,
} from "../../src/lib/jobs/query-understanding";
import {
    applyRelevanceQualityReranking,
    pageRoleTitleHits,
} from "../../src/lib/jobs/meilisearch";
import { titleRelevanceScore } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

const BRAND_PRODUCT_Q = "director of brand and product";

test("roleTitlePairQueries: director of brand and product expands executive prefixes", () => {
    const pairs = roleTitlePairQueries(BRAND_PRODUCT_Q);
    assert.ok(pairs.includes("director brand"));
    assert.ok(pairs.includes("director product"));
    assert.ok(pairs.includes("vp product"));
    assert.ok(pairs.includes("head of brand"));
    assert.ok(pairs.includes("vice president product"));
    assert.ok(pairs.includes("chief brand"));
    assert.ok(pairs.length <= 12);
    assert.ok(!pairs.some((p) => p.includes("director of")));
});

test("roleTitlePairQueries: ampersand normalizes like and", () => {
    const pairs = roleTitlePairQueries("director of brand & product");
    assert.ok(pairs.includes("director brand"));
    assert.ok(pairs.includes("director product"));
});

test("roleTitlePairQueries: the typed title leads the lane when other pairs run it", () => {
    // The lane is the whole result: without its own pair, "Warehouse Associate"
    // searched only "junior warehouse" and listed nothing.
    assert.deepEqual(roleTitlePairQueries("Warehouse Associate"), ["associate warehouse", "junior warehouse"]);
    assert.deepEqual(roleTitlePairQueries("Sales Associate").slice(0, 1), ["associate sales"]);
    assert.deepEqual(roleTitlePairQueries("Product Director").slice(0, 1), ["director product"]);
    assert.deepEqual(roleTitlePairQueries("Junior Developer"), ["junior developer", "associate developer"]);
});

test("roleTitlePairQueries: a typed title with no other pair leaves the search to the normal path", () => {
    assert.deepEqual(roleTitlePairQueries("Marketing Intern"), []);
    assert.equal(shouldRunRoleTitleLane("Marketing Intern", false), false);
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

test("shouldRunRoleTitleLane: false for tech skill and companyScoped", () => {
    assert.equal(shouldRunRoleTitleLane("rust", false), false);
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, true), false);
});

test("shouldRunRoleTitleLane: true for brand/product director on every page", () => {
    assert.equal(shouldRunRoleTitleLane(BRAND_PRODUCT_Q, false), true);
});

test("applyRelevanceQualityReranking: Brand Director outranks Product Data Coordinator", () => {
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

    const ranked = applyRelevanceQualityReranking([coordinator, brandDirector], BRAND_PRODUCT_Q);
    assert.equal(ranked[0].id, "brand-dir");
});

test("titleSatisfiesRoleQuery: keeps director+product and director+brand titles", () => {
    assert.equal(titleSatisfiesRoleQuery("Director, Product Management", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Director, Brand Strategy", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Director of Brand & Product Design", BRAND_PRODUCT_Q), true);
});

test("titleSatisfiesRoleQuery: accepts expanded executive prefixes for director query", () => {
    assert.equal(titleSatisfiesRoleQuery("VP Product", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Head of Brand", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Vice President of Product", BRAND_PRODUCT_Q), true);
    assert.equal(titleSatisfiesRoleQuery("Chief Brand Officer", BRAND_PRODUCT_Q), true);
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

test("role-query page: one-token titles rank below satisfying titles after rerank", () => {
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
    const ranked = applyRelevanceQualityReranking([drop, keep], BRAND_PRODUCT_Q);
    assert.deepEqual(ranked.map((h) => h.id), ["keep", "drop"]);
});

test("pageRoleTitleHits: paginates floored pool with honest total", () => {
    const pool = Array.from({ length: 25 }, (_, i) => ({ id: `job-${i}`, title: `Role ${i}` }) as PublicJob);
    const total = pool.length;
    const page = pageRoleTitleHits(pool, 20, 20);
    assert.equal(total, 25);
    assert.equal(page.length, 5);
    assert.deepEqual(
        page.map((h) => h.id),
        ["job-20", "job-21", "job-22", "job-23", "job-24"],
    );
});
