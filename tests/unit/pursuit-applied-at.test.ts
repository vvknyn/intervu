import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appliedAtForTransition } from '../../src/lib/pursuits/applied-at';
import { countAppliedSince } from '../../src/lib/pursuits/tracker-display';
import type { Pursuit } from '../../src/lib/pursuits/types';

const NOW = '2026-09-30T12:00:00.000Z';

describe('appliedAtForTransition: when marking a role applied records the date', () => {
    it('a role created straight at "applied" gets today', () => {
        assert.equal(appliedAtForTransition(null, 'applied', NOW), NOW);
    });

    it('a saved role moving to "applied" gets today', () => {
        assert.equal(appliedAtForTransition({ status: 'interested' }, 'applied', NOW), NOW);
        assert.equal(appliedAtForTransition({ status: 'resume_ready' }, 'applied', NOW), NOW);
    });

    it('saving a role (not applying) sets no date', () => {
        assert.equal(appliedAtForTransition(null, 'interested', NOW), undefined);
        assert.equal(appliedAtForTransition({ status: 'interested' }, 'interested', NOW), undefined);
    });

    it('a second "Yes" keeps the first date', () => {
        assert.equal(appliedAtForTransition({ status: 'applied', applied_at: '2026-09-20T00:00:00.000Z' }, 'applied', NOW), undefined);
    });

    it('a role already past "applied" never starts counting as applied today', () => {
        for (const status of ['interviewing', 'offer', 'rejected', 'withdrawn'] as const) {
            assert.equal(appliedAtForTransition({ status }, status, NOW), undefined, status);
        }
    });

    it('the date it writes is what "applied this week" counts', () => {
        const pursuit = {
            id: 'p1',
            user_id: 'u1',
            status: 'applied',
            applied_at: appliedAtForTransition({ status: 'interested' }, 'applied', NOW),
            created_at: '2026-09-01T00:00:00.000Z',
            updated_at: NOW,
        } as unknown as Pursuit;
        assert.equal(countAppliedSince([pursuit], Date.parse(NOW) - 7 * 86_400_000), 1);
    });
});
