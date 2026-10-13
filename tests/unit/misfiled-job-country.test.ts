/**
 * A row's tagged country read back from its own place text when the upstream
 * feed misread a country code as a province or state code (review 2026-10-13).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGazetteer } from '../../src/lib/geo/gazetteer';
import { misfiledCountry, withCorrectedCountry } from '../../src/lib/jobs/misfiled-job-country';
import { mkJob } from '../support/jobs-corpus-stub';

const g = loadGazetteer();
const row = (location: string, location_country: string, location_city: string | null = null, location_state: string | null = null) =>
    mkJob('j', { location, location_country, location_city, location_state });

describe('misfiledCountry — a foreign code read as a province or state', () => {
    it('reads Dutch rows tagged Canada ("NL" read as Newfoundland and Labrador) as the Netherlands', () => {
        assert.equal(misfiledCountry(row('Den Haag, NL, 2511 CB', 'Canada', 'Den Haag', 'NL'), g), 'Netherlands');
        assert.equal(misfiledCountry(row('Amersfoort, NL, 3818 LN', 'Canada', 'Amersfoort', 'NL'), g), 'Netherlands');
        assert.equal(misfiledCountry(row('Huis ter Heide (Ut), NL, 3712 BR', 'Canada', 'Huis ter Heide (Ut)', 'NL'), g), 'Netherlands');
    });

    it('reads a Kraków row tagged Canada ("PE" read as Prince Edward Island) as Poland', () => {
        assert.equal(misfiledCountry(row('Kraków PE; Warszawa', 'Canada', 'Kraków', 'PE'), g), 'Poland');
    });

    it('reads US-tagged rows whose code is a country, not a state', () => {
        assert.equal(misfiledCountry(row('Chennai, TN, IN, 600119', 'United States'), g), 'India');
        assert.equal(misfiledCountry(row('Menden, DE', 'United States'), g), 'Germany');
        assert.equal(misfiledCountry(row('Tbilisi, GE', 'United States'), g), 'Georgia');
    });

    it('keeps real Canadian and US places as they are', () => {
        for (const [loc, city, state] of [
            ["St. John's, NL", "St. John's", 'NL'],
            ['Corner Brook, NL, A2H 6J3', 'Corner Brook', 'NL'],
            ['Charlottetown, PE', 'Charlottetown', 'PE'],
            ['London, ON', 'London', 'ON'],
            ['Halifax, NS, CA', 'Halifax', 'NS'],
            ['Montréal', 'Montréal', null],
            ['Toronto, ON', 'Toronto', 'ON'],
        ] as const) {
            assert.equal(misfiledCountry(row(loc, 'Canada', city, state), g), null, loc);
        }
        assert.equal(misfiledCountry(row('Wilmington, DE', 'United States', 'Wilmington', 'DE'), g), null);
        assert.equal(misfiledCountry(row('Atlanta, GA', 'United States', 'Atlanta', 'GA'), g), null);
        assert.equal(misfiledCountry(row('Indianapolis, IN', 'United States', 'Indianapolis', 'IN'), g), null);
    });

    it('leaves a row with no place text, or several tagged countries, alone', () => {
        assert.equal(misfiledCountry(row('', 'Canada'), g), null);
        assert.equal(misfiledCountry(mkJob('m', { location: 'Den Haag, NL, 2511 CB', location_country: ['Canada', 'Netherlands'] }), g), null);
    });

    it('withCorrectedCountry rewrites the tag, and returns the row itself when nothing changes', () => {
        const dutch = row('Den Haag, NL, 2511 CB', 'Canada', 'Den Haag', 'NL');
        assert.equal(withCorrectedCountry(dutch, g).location_country, 'Netherlands');
        const toronto = row('Toronto, ON', 'Canada', 'Toronto', 'ON');
        assert.equal(withCorrectedCountry(toronto, g), toronto);
    });
});
