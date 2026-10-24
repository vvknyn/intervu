import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { candidateCountries, resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import type { AgentPreferences } from '../../src/lib/agent/preferences';
import type { ResumeData } from '../../src/types/resume';

function mkResume(profile: Partial<ResumeData['profile']> = {}): ResumeData {
    return {
        profile: {
            name: '',
            profession: 'Software Engineer',
            yearsOfExperience: 5,
            location: '',
            email: '',
            phone: '',
            linkedin: '',
            ...profile,
        },
        experience: [],
        competencies: [{ category: 'Skills', skills: ['JavaScript', 'React'] }],
        education: [],
        generatedSummary: '',
    };
}

function prefs(search: AgentPreferences['search'] = {}, answers: Partial<AgentPreferences['answers']> = {}): AgentPreferences {
    return { configured: true, search, answers: { custom: {}, ...answers } };
}

describe('resolveCandidateSignals: location is read for every country', () => {
    const cases: [string, string][] = [
        ['Toronto, Ontario, Canada', 'Canada'],
        ['Austin, TX', 'United States'],
        ['London, UK', 'United Kingdom'],
        ['Bengaluru, India', 'India'],
    ];
    for (const [place, country] of cases) {
        it(`${place} -> ${country} (source: resume)`, () => {
            const signals = resolveCandidateSignals(mkResume({ location: place }));
            assert.equal(signals.location.source, 'resume');
            assert.deepEqual(candidateCountries(signals), [country]);
        });
    }

    it('no location anywhere is unknown, not a guessed country', () => {
        const signals = resolveCandidateSignals(mkResume());
        assert.deepEqual(signals.location, { value: null, source: 'unknown' });
        assert.deepEqual(candidateCountries(signals), []);
    });

    it('a place that names no matchable country keeps the place text and no countries', () => {
        const signals = resolveCandidateSignals(mkResume({ location: 'Springfield, Xyzland' }));
        assert.equal(signals.location.source, 'resume');
        assert.deepEqual(candidateCountries(signals), []);
    });
});

describe('resolveCandidateSignals: explicit preferences override the resume', () => {
    it('explicit location beats the resume location', () => {
        const signals = resolveCandidateSignals(mkResume({ location: 'Toronto, Canada' }), prefs({ location: 'Berlin, Germany' }));
        assert.equal(signals.location.source, 'explicit');
        assert.deepEqual(candidateCountries(signals), ['Germany']);
    });

    it('a Settings place whose country only the gazetteer knows still wins: Berlin over Toronto', () => {
        const signals = resolveCandidateSignals(mkResume({ location: 'Toronto, Canada' }), { ...prefs({ location: 'Berlin' }), placeCountries: ['Germany'] });
        assert.deepEqual(signals.location, { value: { countries: ['Germany'], place: 'Berlin' }, source: 'explicit' });
    });

    it('a Settings place that names no country leaves the résumé country in charge', () => {
        for (const location of ['Toronto', 'Anywhere', 'Head Office']) {
            const signals = resolveCandidateSignals(mkResume({ location: 'Toronto, ON' }), prefs({ location }));
            assert.equal(signals.location.source, 'resume', location);
            assert.deepEqual(candidateCountries(signals), ['Canada'], location);
        }
    });

    it('a Settings place that names no country, over a résumé that names none either, stays unknown', () => {
        const signals = resolveCandidateSignals(mkResume({ location: '' }), prefs({ location: 'Anywhere' }));
        assert.deepEqual(signals.location, { value: { countries: [], place: 'Anywhere' }, source: 'explicit' });
    });

    it('explicit experience level beats years on the resume', () => {
        const signals = resolveCandidateSignals(mkResume({ yearsOfExperience: 1 }), prefs({ experienceLevel: 'lead' }));
        // A stated Lead is a level past Senior's own: Staff, Principal and Director roles are then this person's class.
        assert.deepEqual(signals.seniority, { value: 'senior', source: 'explicit', pastSenior: true, levelStated: true });
        assert.equal(resolveCandidateSignals(mkResume({ yearsOfExperience: 1 }), prefs({ experienceLevel: 'senior' })).seniority.pastSenior, undefined);
    });

    it('seniority falls back to years on the resume', () => {
        // With what it was read from, for the reason a role shows: the whole career here (no role of a known kind).
        const read = (years: number) => resolveCandidateSignals(mkResume({ yearsOfExperience: years })).seniority;
        assert.deepEqual(read(1), { value: 'entry', source: 'resume', basis: { level: 'entry', years: 1, role: null } });
        assert.deepEqual(read(6), { value: 'mid', source: 'resume', basis: { level: 'mid', years: 6, role: null } });
        assert.deepEqual(read(12), { value: 'senior', source: 'resume', basis: { level: 'senior', years: 12, role: null } });
    });

    it('remote-only is a statement only when true; false is not one', () => {
        assert.deepEqual(resolveCandidateSignals(mkResume(), prefs({ remoteOnly: true })).remotePreference, { value: 'remote_only', source: 'explicit' });
        assert.deepEqual(resolveCandidateSignals(mkResume(), prefs({ remoteOnly: false })).remotePreference, { value: null, source: 'unknown' });
    });

    it('unconfigured preferences are ignored', () => {
        const unconfigured: AgentPreferences = { configured: false, search: { location: 'Berlin, Germany' }, answers: { custom: {} } };
        assert.equal(resolveCandidateSignals(mkResume({ location: 'Austin, TX' }), unconfigured).location.source, 'resume');
    });
});

describe('resolveCandidateSignals: relocation is explicit-only and never widened', () => {
    const relocation = (text: string) => resolveCandidateSignals(mkResume(), prefs({}, { relocation: text })).relocation;

    it('a resume never states relocation', () => {
        assert.deepEqual(resolveCandidateSignals(mkResume({ location: 'Austin, TX' })).relocation, { value: null, source: 'unknown' });
    });
    it('a named destination is parsed out of a sentence', () => {
        assert.deepEqual(relocation('Open to moving to Netherlands').value, { open: true, countries: ['Netherlands'] });
        assert.deepEqual(relocation('Yes, Germany or Netherlands').value, { open: true, countries: ['Germany', 'Netherlands'] });
    });
    it('"or" / "can" inside the sentence never read as region codes', () => {
        assert.deepEqual(relocation('yes, Germany or Netherlands').value?.countries, ['Germany', 'Netherlands']);
    });
    it('open with no destination is open anywhere', () => {
        assert.deepEqual(relocation('yes').value, { open: true, countries: [] });
        assert.deepEqual(relocation('anywhere').value, { open: true, countries: [] });
    });
    it('a refusal is explicit and closed', () => {
        assert.deepEqual(relocation('Not open to relocating'), { value: { open: false, countries: [] }, source: 'explicit' });
    });
    it('a destination that cannot be resolved is unknown, never "anywhere"', () => {
        assert.deepEqual(relocation('maybe for the right role'), { value: null, source: 'unknown' });
    });
});
