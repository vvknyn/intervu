import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyPendingPrep,
    queuePendingPrep,
    clearPendingPrep,
    takePrepReplay,
    hasPendingPrep,
    type PendingPrepState,
    type PendingPrepStartPayload,
} from '../../src/lib/prep/pending-prep-actions';

// Opaque stand-in payloads — the reducer never inspects them.
type Payload = PendingPrepStartPayload;

function samplePayload(id: string): Payload {
    return {
        jobContext: { id } as unknown as Payload['jobContext'],
        mode: 'learn',
        prepSettings: { questions: 20, reverse: 5, technical: 5, systemDesign: 10 },
        planCacheKey: `plan-${id}`,
    };
}

describe('emptyPendingPrep', () => {
    it('starts with nothing pending', () => {
        const s = emptyPendingPrep();
        assert.deepEqual(s, { start: null });
        assert.equal(hasPendingPrep(s), false);
    });
});

describe('queuePendingPrep — only the latest start is ever pending', () => {
    it('queuing start records the start payload', () => {
        const s = queuePendingPrep(emptyPendingPrep(), { kind: 'start', payload: samplePayload('1') });
        assert.equal(s.start?.planCacheKey, 'plan-1');
        assert.equal(hasPendingPrep(s), true);
    });

    it('queuing start clears a previously-queued start', () => {
        let s: PendingPrepState = queuePendingPrep(emptyPendingPrep(), { kind: 'start', payload: samplePayload('old') });
        s = queuePendingPrep(s, { kind: 'start', payload: samplePayload('new') });
        assert.equal(s.start?.planCacheKey, 'plan-new');
        assert.equal(hasPendingPrep(s), true);
    });
});

describe('clearPendingPrep — dismiss empties the queued start', () => {
    it('empties whatever was pending', () => {
        let s: PendingPrepState = queuePendingPrep(emptyPendingPrep(), { kind: 'start', payload: samplePayload('1') });
        s = clearPendingPrep(s);
        assert.deepEqual(s, { start: null });
        assert.equal(hasPendingPrep(s), false);
    });

    it('is a no-op shape when nothing is pending', () => {
        const s = clearPendingPrep(emptyPendingPrep());
        assert.equal(hasPendingPrep(s), false);
    });
});

describe('takePrepReplay — consume the queued action exactly once on sign-in', () => {
    it('returns the queued start action, then empties so it never replays again', () => {
        const payload = samplePayload('A');
        const s0 = queuePendingPrep(emptyPendingPrep(), { kind: 'start', payload });
        const { next, action } = takePrepReplay(s0);
        assert.deepEqual(action, { kind: 'start', payload });
        assert.equal(hasPendingPrep(next), false, 'state must be empty after take');

        const again = takePrepReplay(next);
        assert.equal(again.action, null);
        assert.equal(hasPendingPrep(again.next), false);
    });

    it('replays NOTHING after the state was cleared (dismiss → unrelated later sign-in)', () => {
        let s = queuePendingPrep(emptyPendingPrep(), { kind: 'start', payload: samplePayload('A') });
        s = clearPendingPrep(s);
        const { next, action } = takePrepReplay(s);
        assert.equal(action, null, 'no stale start may fire after dismiss');
        assert.equal(hasPendingPrep(next), false);
    });

    it('an empty state replays nothing', () => {
        const { action } = takePrepReplay(emptyPendingPrep());
        assert.equal(action, null);
    });
});
