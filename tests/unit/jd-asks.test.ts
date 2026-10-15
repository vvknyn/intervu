/**
 * The hard asks a posting states (jd-asks.ts): a language, a clearance, a certification, managing people,
 * selling. An ask the posting makes optional is never one. Measured 2026-10-15 on a synthetic Canada corpus:
 * 153 of 247 TAM/CSM postings read Strong for a résumé that fit 107, because none of these was read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jdAsksFromDescription, mustSkillsOf } from '../../src/lib/match/jd-asks';

const pad = ' We are a growing company with a friendly team and a long runway.';
const asks = (text: string) => jdAsksFromDescription(text + pad);

describe('languages', () => {
    it('reads a language the posting requires', () => {
        assert.deepEqual(asks('You are fluent in French and English. You will own a book of accounts.')?.langs, ['french']);
        assert.deepEqual(asks('Bilingual (English / Japanese) is required for this role. You will own accounts.')?.langs, ['japanese']);
        assert.deepEqual(asks('Spanish-speaking candidates only. You will own a book of accounts.')?.langs, ['spanish']);
    });
    it('never reads an asset, a plus or a preference as a requirement', () => {
        assert.equal(asks('Bilingualism (English / French) is an asset. You will own a book of accounts.')?.langs, undefined);
        assert.equal(asks('Fluent in German is a plus. You will own a book of accounts.')?.langs, undefined);
        assert.equal(asks('Spanish preferred but not required. You will own a book of accounts.')?.langs, undefined);
    });
});

describe('clearance', () => {
    it('reads a clearance the posting requires', () => {
        assert.equal(asks('You must hold an active Secret clearance. You will own accounts.')?.clearance, true);
        assert.equal(asks('Enhanced Reliability Status required. You will own accounts.')?.clearance, true);
    });
    it('does not read an optional one', () => {
        assert.equal(asks('A security clearance is an asset. You will own accounts.')?.clearance, undefined);
    });
});

describe('managing and selling', () => {
    it('reads direct reports and a team to manage', () => {
        assert.equal(asks('You will have 4 direct reports and own their reviews. Plenty of support.')?.manages, true);
        assert.equal(asks('Lead a team of 8 account managers across the region. Plenty of support.')?.manages, true);
    });
    it('reads a quota and prospecting as selling', () => {
        assert.equal(asks('You will carry a quota and prospect new logos every week. Plenty of support.')?.sells, true);
    });
    it('reads neither from a role that only works with other teams', () => {
        const none = asks('You will partner with sales and support to keep customers healthy. Plenty of support.');
        assert.equal(none?.manages, undefined);
        assert.equal(none?.sells, undefined);
    });
});

describe('certifications', () => {
    it('reads the credentials named on a line that requires a certification', () => {
        assert.deepEqual(asks('Certification required: CISSP and Security+. You will own a book of accounts.')?.creds?.sort(), ['CISSP', 'Security+'].sort());
    });
    it('does not read a tool or a degree as a credential, nor experience with one', () => {
        assert.equal(asks('Experience with AWS and SQL certification programs is helpful. A BSc or MBA. Own accounts.')?.creds, undefined);
        assert.equal(asks('Familiarity with CISSP controls and experience with CRM tools. You will own accounts.')?.creds, undefined);
    });
});

describe('the requirements heading', () => {
    it('keeps the short skill names a real heading listed, lowercased and capped', () => {
        assert.deepEqual(mustSkillsOf(['Zendesk', ' SQL ', 'zendesk']), ['zendesk', 'sql']);
        assert.equal(mustSkillsOf([]), undefined);
        assert.equal(mustSkillsOf(['x'.repeat(60)]), undefined);
    });
    it('carries them with the asks, and says nothing when the posting asks nothing', () => {
        assert.deepEqual(jdAsksFromDescription('Short.', ['Zendesk'])?.must, ['zendesk']);
        assert.equal(jdAsksFromDescription('Short.'), undefined);
        assert.equal(jdAsksFromDescription(null), undefined);
    });
});

describe('years of experience', () => {
    it('reads the years a posting asks of the person, whatever the wording', () => {
        assert.equal(asks('What you bring:\n9+ years of relevant experience\nStrong communication')?.years, 9);
        assert.equal(asks('Minimum 5 years of experience in product management. You will own the roadmap.')?.years, 5);
        assert.equal(asks('You bring at least 7 years of experience in the field. You will own accounts.')?.years, 7);
        assert.equal(asks('We want candidates with 3-5 years of customer success experience. You will own accounts.')?.years, 3);
        assert.equal(asks('Five years\' experience as a nurse is required. You will own a unit.')?.years, 5);
        assert.equal(asks('Experience: 8 yrs in software delivery. You will own the platform.')?.years, 8);
    });
    it('reads several asks as the smallest: the most the posting states for sure', () => {
        assert.equal(asks('5+ years of product management experience\n2+ years managing a roadmap\nSQL')?.years, 2);
    });
    it('never reads a company\'s age, history, a figure that is not experience, or an optional ask', () => {
        assert.equal(asks('Founded in 2008, we have served clients for over 15 years. You will own accounts.')?.years, undefined);
        assert.equal(asks('We have 20 years of history building payments software. You will own accounts.')?.years, undefined);
        assert.equal(asks('With over 10 years of experience, we help retailers grow. You will own accounts.')?.years, undefined);
        assert.equal(asks('You must be 18 years of age or older. You will own accounts.')?.years, undefined);
        assert.equal(asks('In the last 3 years our revenue doubled. You will own accounts.')?.years, undefined);
        assert.equal(asks('8+ years of experience is an asset. You will own accounts.')?.years, undefined);
        assert.equal(asks('Nice to have: 10 years in fintech. You will own accounts.')?.years, undefined);
    });
});
