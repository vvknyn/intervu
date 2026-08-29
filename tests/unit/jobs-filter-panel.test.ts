import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isNoiseFacetValue,
    taggedShare,
    distributionTaggedShare,
    facetGroupVisible,
    FACET_COVERAGE_FLOOR,
} from "../../src/components/jobs/FilterPanel";

test("F4: London (a city, not a country) is excluded from location_country options", () => {
    assert.equal(isNoiseFacetValue("location_country", "London"), true);
});

test("F4: 'Unavailable' (a sentinel-like junk value) is excluded", () => {
    assert.equal(isNoiseFacetValue("location_country", "Unavailable"), true);
});

test("F4: United Kingdom (a real country) is kept", () => {
    assert.equal(isNoiseFacetValue("location_country", "United Kingdom"), false);
});

test("F4 class case: any real country passes regardless of how obscure/low-count it is — no count is even a parameter to this function", () => {
    for (const country of ["Mongolia", "Latvia", "Eswatini", "Kiribati"]) {
        assert.equal(isNoiseFacetValue("location_country", country), false, `${country} must be kept`);
    }
});

test("F4: a raw alias/synonym the classification table recognizes (e.g. 'UK') also counts as a real country, not junk", () => {
    assert.equal(isNoiseFacetValue("location_country", "UK"), false);
});

test("F4: the validator is scoped to location_country only — a non-country facet's values are unaffected by country membership", () => {
    assert.equal(isNoiseFacetValue("work_type", "remote"), false);
    assert.equal(isNoiseFacetValue("employment_type", "internship"), false);
});

test("F5: taggedShare — zero total falls back to null, never a divide-by-zero artifact", () => {
    assert.equal(taggedShare(0, 0), null);
});

test("F5: taggedShare — ordinary case", () => {
    assert.equal(taggedShare(25, 100), 0.25);
});

test("F5: taggedShare — fully tagged", () => {
    assert.equal(taggedShare(100, 100), 1);
});

test("F5: distributionTaggedShare — live-shaped work_type distribution matches the measured ~19.5% tagged share", () => {
    const dist = { unknown: 1692397, remote: 170037, hybrid: 140389, onsite: 101943 };
    const resultTotal = Object.values(dist).reduce((a, b) => a + b, 0);
    const share = distributionTaggedShare(dist, resultTotal);
    assert.ok(share !== null);
    assert.ok(Math.abs(share! - 0.195) < 0.005, `expected ~0.195, got ${share}`);
});

test("F5: distributionTaggedShare — undefined distribution (facet absent from the response) falls back to null, not a lie", () => {
    assert.equal(distributionTaggedShare(undefined, 1000), null);
});

test("F5: distributionTaggedShare — live-shaped boolean (visa_sponsorship) distribution matches the measured ~2.8% tagged share, denominator is the caller's resultTotal", () => {
    const share = distributionTaggedShare({ true: 6018, false: 53810 }, 2_104_766);
    assert.ok(share !== null);
    assert.ok(Math.abs(share! - 0.0284) < 0.002, `expected ~0.0284, got ${share}`);
});

test("F5: distributionTaggedShare — zero resultTotal falls back to null even with a real distribution", () => {
    assert.equal(distributionTaggedShare({ true: 1, false: 1 }, 0), null);
});

test("F5: distributionTaggedShare — array-valued facet (tech_stack-shaped) can exceed 1.0, an upper bound not an exact share, because one doc can tag multiple buckets", () => {
    const share = distributionTaggedShare({ python: 800, sql: 600, react: 500 }, 1000);
    assert.ok(share !== null);
    assert.ok(share! > 1, `expected an over-100% upper bound, got ${share}`);
});

test("Task #48: facetGroupVisible — below FACET_COVERAGE_FLOOR is hidden even with plenty of distinct options (tech_stack on a non-tech search)", () => {
    // ~3% coverage, well under the 0.15 floor — the motivating nursing-search case.
    const dist = { python: 15, sql: 10, excel: 5 };
    assert.equal(facetGroupVisible(dist, 1000, Object.keys(dist)), false);
});

test("Task #48: facetGroupVisible — coverage at/above the floor with >=2 options is visible", () => {
    const dist = { remote: 300, onsite: 200 };
    assert.equal(facetGroupVisible(dist, 1000, Object.keys(dist)), true);
});

test("Task #48: facetGroupVisible — a case OTHER than tech_stack/nursing: high coverage but only ONE selectable option is still hidden (discrimination gate is independent of coverage)", () => {
    const dist = { onsite: 900 };
    assert.equal(facetGroupVisible(dist, 1000, Object.keys(dist)), false);
});

test("Task #48: facetGroupVisible — coverage exactly at the floor passes (>=, not >)", () => {
    const resultTotal = 1000;
    const dist = { remote: FACET_COVERAGE_FLOOR * resultTotal, onsite: 100 };
    assert.equal(facetGroupVisible(dist, resultTotal, Object.keys(dist)), true);
});

test("Task #48: facetGroupVisible — undefined distribution is hidden regardless of options passed in", () => {
    assert.equal(facetGroupVisible(undefined, 1000, ["a", "b"]), false);
});
