import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveApplyClickDecision,
    buildReturnTo,
    persistPendingAction,
    takePersistedPendingAction,
    clearPersistedPendingAction,
    peekPendingActionKind,
    PENDING_ACTION_STORAGE_KEY,
    type PendingActionStorage,
} from '../../src/lib/jobs/pending-actions';
import { validateNextParam } from '../../src/lib/auth/product-routes';

describe('resolveApplyClickDecision — signed-in vs guest Apply click', () => {
    it('signed out must auth-gate before opening the employer site', () => {
        assert.equal(resolveApplyClickDecision(false), 'gate');
    });

    it('signed in performs the action immediately', () => {
        assert.equal(resolveApplyClickDecision(true), 'perform');
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

        const record = takePersistedPendingAction<string, string>(storage, {
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

        const record = takePersistedPendingAction<string, string>(storage, {
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

describe('takePersistedPendingAction — malformed records never reach the caller', () => {
    // Class coverage case (a): a stale record whose action.kind names a kind
    // that no longer exists (this file's own docstring notes "explore" was
    // removed 2026-08-02) — the exact deploy-shape-drift scenario the
    // adversarial review flagged as unexercised by any test.
    it('rejects a record whose action.kind is not a known PendingAction kind, and clears storage', () => {
        const storage = fakeStorage();
        storage.setItem(
            PENDING_ACTION_STORAGE_KEY,
            JSON.stringify({
                action: { kind: 'explore', payload: 'job-X' },
                returnTo: '/jobs',
                scrollY: 0,
                createdAt: 1000,
            }),
        );

        const record = takePersistedPendingAction(storage, { currentPath: '/jobs', now: 1000 });
        assert.equal(record, null);
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null, 'a malformed record must still be cleared');
    });

    // Class coverage case (b): a different malformed field entirely
    // (scrollY, not action.kind) — proving the validation is shape-wide, not
    // a special case for the one field that motivated the fix.
    it('rejects a record whose scrollY is not a number (a stringified "12"), and clears storage', () => {
        const storage = fakeStorage();
        storage.setItem(
            PENDING_ACTION_STORAGE_KEY,
            JSON.stringify({
                action: { kind: 'apply', payload: 'job-A' },
                returnTo: '/jobs',
                scrollY: '12',
                createdAt: 1000,
            }),
        );

        const record = takePersistedPendingAction(storage, { currentPath: '/jobs', now: 1000 });
        assert.equal(record, null);
        assert.equal(storage.getItem(PENDING_ACTION_STORAGE_KEY), null, 'a malformed record must still be cleared');
    });

    it('still accepts and round-trips a well-formed record', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'report', payload: 'job-R' },
            returnTo: '/jobs',
            scrollY: 120,
            createdAt: 1000,
        });

        const record = takePersistedPendingAction<string, string>(storage, {
            currentPath: '/jobs',
            now: 1000,
        });
        assert.deepEqual(record?.action, { kind: 'report', payload: 'job-R' });
        assert.equal(record?.scrollY, 120);
    });
});

describe('peekPendingActionKind — read without consume for post-auth routing', () => {
    it('returns the queued kind and leaves storage intact', () => {
        const storage = fakeStorage();
        persistPendingAction(storage, {
            action: { kind: 'upload', payload: true },
            returnTo: '/jobs',
            scrollY: 0,
            createdAt: 1000,
        });
        assert.equal(peekPendingActionKind(storage), 'upload');
        assert.ok(storage.getItem(PENDING_ACTION_STORAGE_KEY));
    });
});

describe('validateNextParam — post-auth return target keeps query + hash (gate surfaces)', () => {
    it('accepts a /jobs path carrying both a query string and a hash', () => {
        assert.equal(validateNextParam('/jobs?query=x&job=123#top'), '/jobs?query=x&job=123#top');
    });
});
