import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyCountryValue,
    rollupCountryDistribution,
    UNCLASSIFIED_LABEL,
} from '../../src/lib/jobs/country-classification';

// The /trends "Top hiring countries" section validates every raw
// `location_country` facet value against a static country table instead of
// special-casing the specific junk values seen live (2026-07-29 probe):
// city names ("London", "San Francisco", "Berlin", "Santa Clara") AND a
// distinct second garbage class (remote/multi-location sentinels) both need
// to land in "Unclassified" — never dropped, never individually hardcoded.
describe('classifyCountryValue', () => {
    it('a real country matches exactly', () => {
        assert.deepEqual(classifyCountryValue('United States'), { kind: 'country', canonical: 'United States' });
        assert.deepEqual(classifyCountryValue('Canada'), { kind: 'country', canonical: 'Canada' });
    });

    it('is case-insensitive and trims whitespace', () => {
        assert.deepEqual(classifyCountryValue('  canada  '), { kind: 'country', canonical: 'Canada' });
        assert.deepEqual(classifyCountryValue('GERMANY'), { kind: 'country', canonical: 'Germany' });
    });

    it('known aliases merge onto the same canonical name (UK/United Kingdom)', () => {
        assert.deepEqual(classifyCountryValue('UK'), { kind: 'country', canonical: 'United Kingdom' });
        assert.deepEqual(classifyCountryValue('United Kingdom'), { kind: 'country', canonical: 'United Kingdom' });
        assert.deepEqual(classifyCountryValue('USA'), { kind: 'country', canonical: 'United States' });
        assert.deepEqual(classifyCountryValue('U.S.'), { kind: 'country', canonical: 'United States' });
    });

    it('CITY-IN-COUNTRY-FIELD class — city names are not countries', () => {
        for (const city of ['London', 'San Francisco', 'Berlin', 'Santa Clara']) {
            assert.deepEqual(classifyCountryValue(city), { kind: 'unclassified', canonical: city });
        }
    });

    it('a DISTINCT garbage class — remote/multi-location sentinels are not countries either', () => {
        for (const sentinel of ['Remote', 'Multiple Locations', 'Nationwide']) {
            assert.deepEqual(classifyCountryValue(sentinel), { kind: 'unclassified', canonical: sentinel });
        }
    });

    it('a near-miss misspelling ("Columbia" for "Colombia") is NOT force-matched — no per-value guessing', () => {
        assert.deepEqual(classifyCountryValue('Columbia'), { kind: 'unclassified', canonical: 'Columbia' });
    });
});

describe('rollupCountryDistribution', () => {
    it('merges alias variants into one row and sums their counts', () => {
        const rows = rollupCountryDistribution({ 'United Kingdom': 200, UK: 50 });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].country, 'United Kingdom');
        assert.equal(rows[0].count, 250);
        assert.deepEqual(new Set(rows[0].rawValues), new Set(['United Kingdom', 'UK']));
    });

    it('sorts real countries by count, descending', () => {
        const rows = rollupCountryDistribution({ India: 10, 'United States': 500, Canada: 100 });
        assert.deepEqual(rows.map((r) => r.country), ['United States', 'Canada', 'India']);
    });

    it('rolls unmatched values into ONE Unclassified row, always last — even when it outweighs every real country', () => {
        const rows = rollupCountryDistribution({
            Canada: 5,
            London: 1000,
            'San Francisco': 1000,
            Remote: 1000,
        });
        assert.equal(rows.at(-1)?.country, UNCLASSIFIED_LABEL);
        assert.equal(rows.at(-1)?.count, 3000);
        assert.equal(rows.at(-1)?.rawValues, undefined);
        // Still ranked ahead of Unclassified despite being smaller — Unclassified is a footnote, not a ranked entry.
        assert.equal(rows[0].country, 'Canada');
    });

    it('no Unclassified row when every value classifies as a country', () => {
        const rows = rollupCountryDistribution({ Canada: 5, Germany: 3 });
        assert.equal(rows.some((r) => r.country === UNCLASSIFIED_LABEL), false);
    });

    it('empty/undefined distribution returns an empty list, not a fabricated row', () => {
        assert.deepEqual(rollupCountryDistribution(undefined), []);
        assert.deepEqual(rollupCountryDistribution({}), []);
    });
});
