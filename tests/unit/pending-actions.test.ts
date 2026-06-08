import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyPending,
    queuePending,
    clearPending,
    takeReplay,
    hasPending,
    type PendingState,
} from '../../src/lib/jobs/pending-actions';

// The reducer is generic over the action payloads. For the tests we use plain
// string payloads to stand in for the PublicJob / ResumeData the page passes —
// the module never inspects them, so any opaque value works.
type S = PendingState<string, string, string>;

describe('emptyPending', () => {
    it('starts with nothing pending', () => {
        const s = emptyPending<string, string, string>();
        assert.deepEqual(s, { apply: null, tailor: null, upload: null, explore: null });
        assert.equal(hasPending(s), false);
    });
});

describe('queuePending — only the latest action is ever pending', () => {
    it('queuing apply records the apply payload', () => {
        const s = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-1' });
        assert.equal(s.apply, 'job-1');
        assert.equal(hasPending(s), true);
    });

    it('queuing apply clears a previously-queued tailor', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'tailor', payload: 'job-T' });
        assert.equal(s.tailor, 'job-T');
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        assert.equal(s.apply, 'job-A');
        assert.equal(s.tailor, null, 'queuing apply must clear the stale tailor');
        assert.equal(s.upload, null);
        assert.equal(s.explore, null);
    });

    it('queuing tailor clears a previously-queued apply', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'tailor', payload: 'job-T' });
        assert.equal(s.tailor, 'job-T');
        assert.equal(s.apply, null, 'queuing tailor must clear the stale apply');
    });

    it('queuing upload clears apply/tailor/explore (gate vs action are mutually exclusive)', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'explore', payload: 'resume-1' });
        s = queuePending(s, { kind: 'upload', payload: true });
        assert.equal(s.upload, true);
        assert.equal(s.apply, null);
        assert.equal(s.tailor, null);
        assert.equal(s.explore, null);
    });

    it('queuing explore records the resume payload and clears the rest', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'explore', payload: 'resume-7' });
        assert.equal(s.explore, 'resume-7');
        assert.equal(s.apply, null);
    });
});

describe('clearPending — alternate path / dismiss empties everything', () => {
    it('empties whatever was pending', () => {
        let s: S = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-A' });
        s = clearPending(s);
        assert.deepEqual(s, { apply: null, tailor: null, upload: null, explore: null });
        assert.equal(hasPending(s), false);
    });

    it('is a no-op shape when nothing is pending', () => {
        const s = clearPending(emptyPending<string, string, string>());
        assert.equal(hasPending(s), false);
    });
});

describe('takeReplay — consume the queued action exactly once on sign-in', () => {
    it('returns the queued apply action, then empties so it never replays again', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-A' });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'apply', payload: 'job-A' });
        assert.equal(hasPending(next), false, 'state must be empty after take');

        // A second sign-in / second take must produce nothing — no phantom replay.
        const again = takeReplay(next);
        assert.equal(again.action, null);
        assert.equal(hasPending(again.next), false);
    });

    it('returns the queued tailor action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'tailor', payload: 'job-T' });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'tailor', payload: 'job-T' });
        assert.equal(hasPending(next), false);
    });

    it('returns the queued upload action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'upload', payload: true });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'upload', payload: true });
        assert.equal(hasPending(next), false);
    });

    it('returns the queued explore action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'explore', payload: 'resume-7' });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'explore', payload: 'resume-7' });
        assert.equal(hasPending(next), false);
    });

    // The race-critical regression: a dismissed/cleared state must replay NOTHING
    // when the user later signs in via an unrelated trigger.
    it('replays NOTHING after the state was cleared (dismiss → unrelated later sign-in)', () => {
        let s: S = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-A' });
        s = clearPending(s); // user dismissed the popover and kept browsing
        const { next, action } = takeReplay(s); // later signs in elsewhere
        assert.equal(action, null, 'no stale apply may fire after dismiss');
        assert.equal(hasPending(next), false);
    });

    it('an empty state replays nothing', () => {
        const { action } = takeReplay(emptyPending<string, string, string>());
        assert.equal(action, null);
    });
});
