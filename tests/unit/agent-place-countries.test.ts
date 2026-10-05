import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withPlaceCountries } from '../../src/lib/agent/place-countries';
import type { AgentPreferences } from '../../src/lib/agent/preferences';

const prefs = (location?: string): AgentPreferences => ({ configured: true, search: { location }, answers: { custom: {} } });

/**
 * A Settings place saved as a bare city ("Toronto", often left behind by a /jobs search before
 * searches stopped saving it) named no country, so the person's country read as unknown and
 * US-only roles kept a fit word for someone in Canada (2026-10-05).
 */
describe('withPlaceCountries: the country of a saved place its words alone do not name', () => {
    it('reads a bare city for any country', () => {
        assert.deepEqual(withPlaceCountries(prefs('Toronto')).placeCountries, ['Canada']);
        assert.deepEqual(withPlaceCountries(prefs('Bengaluru')).placeCountries, ['India']);
        assert.deepEqual(withPlaceCountries(prefs('Berlin')).placeCountries, ['Germany']);
        assert.deepEqual(withPlaceCountries(prefs('São Paulo')).placeCountries, ['Brazil']);
    });

    it('adds nothing when the words already name the country, or name no place', () => {
        for (const location of ['Toronto, Canada', 'Ontario', 'Remote', 'Head Office', '', undefined]) {
            assert.equal(withPlaceCountries(prefs(location)).placeCountries, undefined, String(location));
        }
    });

    it('never touches what is stored', () => {
        const saved = prefs('Toronto');
        const read = withPlaceCountries(saved);
        assert.deepEqual(read.search, saved.search);
        assert.equal(saved.placeCountries, undefined);
    });
});
