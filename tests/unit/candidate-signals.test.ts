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

    it('explicit experience level beats years on the resume', () => {
        const signals = resolveCandidateSignals(mkResume({ yearsOfExperience: 1 }), prefs({ experienceLevel: 'lead' }));
        assert.deepEqual(signals.seniority, { value: 'senior', source: 'explicit' });
    });

    it('seniority falls back to years on the resume', () => {
        assert.deepEqual(resolveCandidateSignals(mkResume({ yearsOfExperience: 1 })).seniority, { value: 'entry', source: 'resume' });
        assert.deepEqual(resolveCandidateSignals(mkResume({ yearsOfExperience: 6 })).seniority, { value: 'mid', source: 'resume' });
        assert.deepEqual(resolveCandidateSignals(mkResume({ yearsOfExperience: 12 })).seniority, { value: 'senior', source: 'resume' });
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
