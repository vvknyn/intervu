import { test } from "node:test";
import assert from "node:assert/strict";
import { isNoiseFacetValue, taggedShare, distributionTaggedShare, booleanTaggedShare } from "../../src/components/jobs/FilterPanel";

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
    const share = distributionTaggedShare({ unknown: 1692397, remote: 170037, hybrid: 140389, onsite: 101943 });
    assert.ok(share !== null);
    assert.ok(Math.abs(share! - 0.195) < 0.005, `expected ~0.195, got ${share}`);
});

test("F5: distributionTaggedShare — undefined distribution (facet absent from the response) falls back to null, not a lie", () => {
    assert.equal(distributionTaggedShare(undefined), null);
});

test("F5: booleanTaggedShare — live-shaped visa_sponsorship distribution matches the measured ~2.8% tagged share", () => {
    const share = booleanTaggedShare({ true: 6018, false: 53810 }, 2_104_766);
    assert.ok(share !== null);
    assert.ok(Math.abs(share! - 0.0284) < 0.002, `expected ~0.0284, got ${share}`);
});

test("F5: booleanTaggedShare — undefined distribution falls back to null even with a positive resultTotal", () => {
    assert.equal(booleanTaggedShare(undefined, 1000), null);
});

test("F5: booleanTaggedShare — zero resultTotal falls back to null", () => {
    assert.equal(booleanTaggedShare({ true: 1, false: 1 }, 0), null);
});
