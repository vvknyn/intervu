/**
 * Whole-résumé fit (Vivek, 2026-10-13): a PM-and-TAM résumé, a CSM posting read Good at
 * 35% of what it asks, a re-stamped posting first seen 138 days ago, and a deck tuned so
 * hard toward Customer Success that the résumé's own order was gone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evidencedSecondaryTitles, targetRoles } from '../../src/lib/jobs/resume-match';
import { packAgeTier } from '../../src/lib/jobs/for-you/band-order';
import { maxShift, MAX_TUNING_SHIFT, summarizeTuning, type TuningNudge } from '../../src/lib/jobs/for-you/tuning';
import { JD_GOOD_MIN_FIT, MATCH_BAND_GOOD_MIN } from '../../src/lib/match/score';
import type { ResumeData } from '../../src/types/resume';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86_400_000;
const resume = (summary: string, description: string): ResumeData =>
    ({
        profile: { name: 'A', profession: 'Product Manager', location: 'Toronto, Ontario' },
        experience: [{ id: 'e1', company: 'X', role: 'Product Manager', dates: '2021 - Present', description }],
        competencies: [],
        education: [],
        generatedSummary: summary,
    }) as unknown as ResumeData;

describe('a second title the résumé holds', () => {
    it('counts when the experience says they hold it', () => {
        const r = resume('Product Manager and Technical Account Manager with an engineering background.', 'Serve as named Technical Account Manager for the Medibank account.');
        assert.deepEqual(evidencedSecondaryTitles(r, 'Product Manager and Technical Account Manager'), ['Technical Account Manager']);
        assert.ok(targetRoles(r).own.some((t) => /technical account manager/i.test(t)));
    });
    it('does not count when the body only describes the work', () => {
        const r = resume('Technical Account Manager and client-facing product owner.', 'Sole technical product owner of a major account.');
        assert.deepEqual(evidencedSecondaryTitles(r, 'Technical Account Manager and client-facing product owner'), []);
    });
});

describe('reposts and fit bands', () => {
    it('a posting first seen over 60 days ago is too old for a pack, whatever date it claims now', () => {
        assert.equal(packAgeTier(NOW - 4 * DAY, NOW, new Date(NOW - 138 * DAY).toISOString()), 2);
        assert.equal(packAgeTier(NOW - 4 * DAY, NOW, new Date(NOW - 20 * DAY).toISOString()), 0);
    });
    it('Good needs half of what the posting asks', () => {
        assert.equal(JD_GOOD_MIN_FIT, 0.5);
        assert.equal(MATCH_BAND_GOOD_MIN, 60);
    });
});

describe('tuning nudges, never pins', () => {
    it('moves a role at most MAX_TUNING_SHIFT places', () => {
        assert.equal(maxShift(100), MAX_TUNING_SHIFT);
    });
    it('reading roles does not name the deck', () => {
        const features = { label: 'Customer Success Manager', terms: [], role: 'Customer Success Manager' } as unknown as TuningNudge['features'];
        const reads = Array.from({ length: 10 }, (_, i) => ({ jobId: `j${i}`, signal: 'dwell', at: NOW, features }) as TuningNudge);
        assert.equal(summarizeTuning(reads, NOW), null);
    });
});
