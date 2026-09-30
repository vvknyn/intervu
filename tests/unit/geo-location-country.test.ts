import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadGazetteer } from '../../src/lib/geo/gazetteer';
import { readLocationCountry } from '../../src/lib/geo/location-country';

const gazetteer = loadGazetteer();
const paired = (text: string) => readLocationCountry(text, gazetteer).paired;
const named = (text: string) => readLocationCountry(text, gazetteer).named;

describe('readLocationCountry: a place beside its state or country', () => {
    it('pairs a city with the code that contains it', () => {
        assert.equal(paired('CA, Oakville 1, Office'), 'CA'); // Canada has an Oakville; California has none.
        assert.equal(paired('Paris, TX'), 'US');
        assert.equal(paired('Manchester, NH'), 'US');
        assert.equal(paired('London, ON'), 'CA');
        assert.equal(paired('Berlin, DE'), 'DE');
        assert.equal(paired('New Delhi, IN'), 'IN');
        assert.equal(paired('US-CA-San Francisco'), 'US');
    });

    it('pairs a city with a state or country named in full', () => {
        assert.equal(paired('London, Ontario'), 'CA');
        assert.equal(paired('Toronto, Ontario, Canada'), 'CA');
        assert.equal(paired('Atlanta, Georgia'), 'US');
        assert.equal(paired('Tbilisi, Georgia'), 'GE');
    });

    it('no pair when the text nests both ways or names one place', () => {
        assert.equal(paired('Ontario, CA'), null); // the province in Canada, or the Californian city
        assert.equal(paired('London'), null);
        assert.equal(paired('Remote - US'), null);
    });
});

describe('readLocationCountry: a place named on its own', () => {
    it('reads nicknames, states and dominant cities', () => {
        assert.equal(named('NYC Office'), 'US');
        assert.equal(named('Utah County Administration Building'), 'US');
        assert.equal(named('Salt Lake City Office'), 'US');
        assert.equal(named('Remote - US'), 'US');
        assert.equal(named('Remote - UK'), 'GB');
        assert.equal(named('Hybrid - London'), 'GB');
        assert.equal(named('Ontario'), 'CA');
        assert.equal(named('Bangalore'), 'IN');
    });

    it('a big city outweighs a small state of the same name elsewhere', () => {
        assert.equal(named('Manchester'), 'GB'); // not the Jamaican parish
    });

    it('a toss-up or an ambiguous code names nothing', () => {
        assert.equal(named('Cambridge'), null); // England 146k, Ontario 130k, Massachusetts 110k
        assert.equal(named('Georgia'), null);
        assert.equal(named('Remote, IN'), null); // India or Indiana
        assert.equal(named('San Jose'), null);
    });

    it('office words and generic regions name nothing', () => {
        for (const text of ['Head Office', 'Service Centre', 'Remote', 'Multiple Locations', 'Store 1234', 'Downtown', 'Field Based - North West', 'West Coast']) {
            assert.deepEqual(readLocationCountry(text, gazetteer), { paired: null, named: null }, text);
        }
    });

    it('a county the gazetteer does not hold stays unread', () => {
        assert.deepEqual(readLocationCountry('Merseyside Hire And Service Centre', gazetteer), { paired: null, named: null });
        assert.deepEqual(readLocationCountry(null, gazetteer), { paired: null, named: null });
    });
});
