import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    emptyPending,
    queuePending,
    clearPending,
    takeReplay,
    hasPending,
    resolveApplyGateDecision,
    buildReturnTo,
    persistPendingAction,
    takePersistedPendingAction,
    clearPersistedPendingAction,
    PENDING_ACTION_STORAGE_KEY,
    type PendingState,
    type PendingActionStorage,
} from '../../src/lib/jobs/pending-actions';
import { validateNextParam } from '../../src/lib/auth/product-routes';

// The reducer is generic over the action payloads. For the tests we use plain
// string payloads to stand in for the PublicJob the page passes — the module
// never inspects them, so any opaque value works.
type S = PendingState<string, string, string>;

describe('emptyPending', () => {
    it('starts with nothing pending', () => {
        const s = emptyPending<string, string, string>();
        assert.deepEqual(s, { apply: null, gate: null, upload: null, report: null });
        assert.equal(hasPending(s), false);
    });
});

describe('queuePending — only the latest action is ever pending', () => {
    it('queuing apply records the apply payload', () => {
        const s = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-1' });
        assert.equal(s.apply, 'job-1');
        assert.equal(hasPending(s), true);
    });

    it('queuing apply clears a previously-queued gate', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'gate', payload: 'job-G' });
        assert.equal(s.gate, 'job-G');
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        assert.equal(s.apply, 'job-A');
        assert.equal(s.gate, null, 'queuing apply must clear the stale gate');
        assert.equal(s.upload, null);
        assert.equal(s.report, null);
    });

    it('queuing gate clears a previously-queued apply', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'gate', payload: 'job-G' });
        assert.equal(s.gate, 'job-G');
        assert.equal(s.apply, null, 'queuing gate must clear the stale apply');
    });

    it('queuing upload clears apply/gate (gate vs action are mutually exclusive)', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'upload', payload: true });
        assert.equal(s.upload, true);
        assert.equal(s.apply, null);
        assert.equal(s.gate, null);
        assert.equal(s.report, null);
    });

    it('queuing report clears apply/gate/upload', () => {
        let s: S = emptyPending<string, string, string>();
        s = queuePending(s, { kind: 'apply', payload: 'job-A' });
        s = queuePending(s, { kind: 'report', payload: 'job-R' });
        assert.equal(s.report, 'job-R');
        assert.equal(s.apply, null);
        assert.equal(s.gate, null);
        assert.equal(s.upload, null);
    });
});

describe('clearPending — alternate path / dismiss empties everything', () => {
    it('empties whatever was pending', () => {
        let s: S = queuePending(emptyPending<string, string, string>(), { kind: 'apply', payload: 'job-A' });
        s = clearPending(s);
        assert.deepEqual(s, { apply: null, gate: null, upload: null, report: null });
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

    // Job 2 (2026-08-01) — the generic apply-gate kind queued by card "Apply",
    // "Go after this job", and "Open posting" when signed out. A second,
    // distinct action kind from 'apply' above, proving the fix is class-wide
    // rather than hard-coded to one button.
    it('returns the queued gate action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'gate', payload: 'job-G' });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'gate', payload: 'job-G' });
        assert.equal(hasPending(next), false);
    });

    it('returns the queued upload action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'upload', payload: true });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'upload', payload: true });
        assert.equal(hasPending(next), false);
    });

    it('returns the queued report action once', () => {
        const s0: S = queuePending(emptyPending<string, string, string>(), { kind: 'report', payload: 'job-R' });
        const { next, action } = takeReplay(s0);
        assert.deepEqual(action, { kind: 'report', payload: 'job-R' });
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

describe('resolveApplyGateDecision — signed-in vs signed-out branch for the apply gate', () => {
    it('signed out always gates', () => {
        assert.equal(resolveApplyGateDecision(false), 'gate');
    });

    it('signed in always performs the action immediately, no dialog', () => {
        assert.equal(resolveApplyGateDecision(true), 'perform');
    });
});

describe('buildReturnTo — pathname + search + hash for the post-auth return target', () => {
    it('keeps query and hash', () => {
        const returnTo = buildReturnTo({ pathname: '/jobs', search: '?query=engineer', hash: '#top' });
        assert.equal(returnTo, '/jobs?query=engineer#top');
    });

    it('is just the pathname when there is no query or hash', () => {
        const returnTo = buildReturnTo({ pathname: '/jobs/some-job', search: '', hash: '' });
        assert.equal(returnTo, '/jobs/some-job');
    });
});

/** In-memory stand-in for `sessionStorage` — a real `Map`, plus a `throwing`
 *  flag so the same fake can also model a blocked/full storage without
 *  needing `jsdom` just to get a `Storage`-shaped object under `tsx --test`. */
function fakeStorage(): PendingActionStorage & { throwing: boolean } {
    const data = new Map<string, string>();
    return {
        throwing: false,
        getItem(key) {
            if (this.throwing) throw new Error('storage blocked');
            return data.has(key) ? data.get(key)! : null;
        },
        setItem(key, value) {
            if (this.throwing) throw new Error('storage blocked');
            data.set(key, value);
        },
        removeItem(key) {
            if (this.throwing) throw new Error('storage blocked');
            data.delete(key);
        },
    };
}

describe('persistPendingAction / takePersistedPendingAction — survives a hard-nav auth round trip', () => {
    it('round-trips an apply action back on the same path', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'apply', payload: 'job-A' },
            returnTo: '/jobs/job-A?query=engineer',
            scrollY: 240,
            createdAt: 1000,
        });

        const record = takePersistedPendingAction<string, string, string>(storage, {
            currentPath: '/jobs/job-A',
            now: 1500,
        });
        assert.deepEqual(record?.action, { kind: 'apply', payload: 'job-A' });
        assert.equal(record?.scrollY, 240);
        assert.equal(record?.returnTo, '/jobs/job-A?query=engineer');
    });

    // Second class case beyond "report": a plain "apply" replay round-trips
    // through the exact same persistence helpers — proving this is class-wide
    // storage for any PendingAction kind, not a report-specific mechanism.
    it('round-trips a report action back on the same path', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'report', payload: 'job-R' },
            returnTo: '/jobs/job-R',
            scrollY: 0,
            createdAt: 1000,
        });

        const record = takePersistedPendingAction<string, string, string>(storage, {
            currentPath: '/jobs/job-R',
            now: 1000,
        });
        assert.deepEqual(record?.action, { kind: 'report', payload: 'job-R' });
    });

    it('clears the record after taking it — a second take returns null', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'apply', payload: 'job-A' },
            returnTo: '/jobs/job-A',
            scrollY: 0,
            createdAt: 1000,
        });
        takePersistedPendingAction(storage, { currentPath: '/jobs/job-A', now: 1000 });
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null);

        const again = takePersistedPendingAction(storage, { currentPath: '/jobs/job-A', now: 1000 });
        assert.equal(again, null);
    });

    it('clears and returns null when the record has expired', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'apply', payload: 'job-A' },
            returnTo: '/jobs/job-A',
            scrollY: 0,
            createdAt: 1000,
        });

        // 16 minutes later, past the default 15-minute maxAgeMs.
        const record = takePersistedPendingAction(storage, {
            currentPath: '/jobs/job-A',
            now: 1000 + 16 * 60_000,
        });
        assert.equal(record, null);
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null, 'expired record must still be cleared');
    });

    it('clears and returns null when returnTo does not match the current path', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'apply', payload: 'job-A' },
            returnTo: '/jobs/job-A',
            scrollY: 0,
            createdAt: 1000,
        });

        // Same tab navigated to a different job before ever authenticating.
        const record = takePersistedPendingAction(storage, { currentPath: '/jobs/job-B', now: 1000 });
        assert.equal(record, null);
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null, 'mismatched record must still be cleared');
    });

    it('returns null (never throws) when nothing is persisted', () => {
        const storage = fakeStorage();
        const record = takePersistedPendingAction(storage, { currentPath: '/jobs', now: 1000 });
        assert.equal(record, null);
    });

    it('tolerates a storage that throws on write, read, and clear', () => {
        const storage = fakeStorage();
        storage.throwing = true;
        assert.doesNotThrow(() =>
            persistPendingAction(storage, {
                action: { kind: 'apply', payload: 'job-A' },
                returnTo: '/jobs/job-A',
                scrollY: 0,
                createdAt: 1000,
            }),
        );
        assert.doesNotThrow(() => clearPersistedPendingAction(storage));
        let record: unknown;
        assert.doesNotThrow(() => {
            record = takePersistedPendingAction(storage, { currentPath: '/jobs/job-A', now: 1000 });
        });
        assert.equal(record, null);
    });

    it('clearPersistedPendingAction removes a stored record directly', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'apply', payload: 'job-A' },
            returnTo: '/jobs/job-A',
            scrollY: 0,
            createdAt: 1000,
        });
        clearPersistedPendingAction(storage);
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null);
    });
});

describe('validateNextParam — post-auth return target keeps query + hash (gate surfaces)', () => {
    it('accepts a /jobs path carrying both a query string and a hash', () => {
        assert.equal(validateNextParam('/jobs?query=x&job=123#top'), '/jobs?query=x&job=123#top');
    });
});
