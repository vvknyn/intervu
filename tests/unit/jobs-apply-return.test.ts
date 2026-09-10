import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    shouldPromptApplyReturn,
    armApplyReturn,
    evaluateApplyReturn,
    readApplyReturnRecord,
    APPLY_RETURN_THRESHOLD_MS,
    APPLY_RETURN_STORAGE_KEY,
    type ApplyReturnStorage,
} from '../../src/lib/jobs/apply-return';

/** Minimal in-memory `ApplyReturnStorage` stub — a plain object rather than
 *  a real `sessionStorage`/jsdom, per the module's own doc comment on why
 *  it takes a `Pick<Storage, ...>` instead of the full DOM interface. */
function memoryStorage(seed: Record<string, string> = {}): ApplyReturnStorage {
    const store = new Map(Object.entries(seed));
    return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
            store.set(key, value);
        },
        removeItem: (key) => {
            store.delete(key);
        },
    };
}

const JOB_A = { jobId: 'job-a', title: 'Backend Engineer', company: 'Acme' };
const JOB_B = { jobId: 'job-b', title: 'Frontend Engineer', company: 'Widgets Co' };
const neverApplied = () => false;

function input(overrides: Partial<Parameters<typeof shouldPromptApplyReturn>[0]> = {}) {
    return {
        awayMs: APPLY_RETURN_THRESHOLD_MS,
        alreadyApplied: false,
        alreadyPrompted: false,
        ...overrides,
    };
}

describe('shouldPromptApplyReturn', () => {
    it('stays quiet under the threshold — a tab glance, not an application trip', () => {
        assert.equal(shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS - 1 })), false);
    });

    it('prompts once the away time clears the threshold', () => {
        assert.equal(shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS })), true);
    });

    it('never prompts once this job is already marked applied, no matter how long they were away', () => {
        assert.equal(
            shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS * 10, alreadyApplied: true })),
            false,
        );
    });

    // The class case: a visitor dismisses the prompt, switches away and back
    // to the SAME job a second time — must not re-prompt.
    it('does not re-prompt the same job on a second return after an earlier dismiss', () => {
        assert.equal(
            shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS * 2, alreadyPrompted: true })),
            false,
        );
    });

    it('a fresh, different job (never prompted) still prompts on its own merits', () => {
        assert.equal(
            shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS, alreadyPrompted: false })),
            true,
        );
    });

    it('boundary is inclusive: exactly the threshold counts as over it', () => {
        assert.equal(shouldPromptApplyReturn(input({ awayMs: APPLY_RETURN_THRESHOLD_MS })), true);
    });
});

describe('armApplyReturn / evaluateApplyReturn (storage + one-shot record)', () => {
    it('arm, then return after >=10s: prompts once and never again for that job', () => {
        const storage = memoryStorage();
        const leftAt = 1_000;
        armApplyReturn(storage, JOB_A, leftAt);

        const first = evaluateApplyReturn(storage, leftAt + APPLY_RETURN_THRESHOLD_MS, neverApplied);
        assert.ok(first);
        assert.equal(first?.jobId, JOB_A.jobId);
        assert.equal(first?.prompted, true);

        // Same return firing twice (visibilitychange + focus both landing) —
        // and a later, separate return to the same tab — must not re-prompt.
        const second = evaluateApplyReturn(storage, leftAt + APPLY_RETURN_THRESHOLD_MS, neverApplied);
        assert.equal(second, null);
        const muchLater = evaluateApplyReturn(storage, leftAt + APPLY_RETURN_THRESHOLD_MS * 100, neverApplied);
        assert.equal(muchLater, null);
    });

    it('return after 3s (under threshold) does not prompt', () => {
        const storage = memoryStorage();
        const leftAt = 5_000;
        armApplyReturn(storage, JOB_A, leftAt);

        const result = evaluateApplyReturn(storage, leftAt + 3_000, neverApplied);
        assert.equal(result, null);
        // Still pending, unprompted — a later genuine return can still fire.
        const record = readApplyReturnRecord(storage);
        assert.equal(record?.prompted, false);
    });

    it('a job already marked applied never prompts, no matter the away time', () => {
        const storage = memoryStorage();
        const leftAt = 0;
        armApplyReturn(storage, JOB_A, leftAt);

        const result = evaluateApplyReturn(
            storage,
            leftAt + APPLY_RETURN_THRESHOLD_MS * 5,
            (jobId) => jobId === JOB_A.jobId,
        );
        assert.equal(result, null);
    });

    it('corrupt or missing storage reads as "nothing pending" — no throw', () => {
        const missing = memoryStorage();
        assert.doesNotThrow(() => {
            assert.equal(readApplyReturnRecord(missing), null);
            assert.equal(evaluateApplyReturn(missing, Date.now(), neverApplied), null);
        });

        const corrupt = memoryStorage({ [APPLY_RETURN_STORAGE_KEY]: '{not valid json' });
        assert.doesNotThrow(() => {
            assert.equal(readApplyReturnRecord(corrupt), null);
            assert.equal(evaluateApplyReturn(corrupt, Date.now(), neverApplied), null);
        });

        const wrongShape = memoryStorage({ [APPLY_RETURN_STORAGE_KEY]: JSON.stringify({ foo: 'bar' }) });
        assert.doesNotThrow(() => {
            assert.equal(readApplyReturnRecord(wrongShape), null);
        });

        const throwingStorage: ApplyReturnStorage = {
            getItem: () => {
                throw new Error('quota/private-mode read failure');
            },
            setItem: () => {},
            removeItem: () => {},
        };
        assert.doesNotThrow(() => {
            assert.equal(readApplyReturnRecord(throwingStorage), null);
        });
    });

    it('a second job replaces the first — one slot, latest wins', () => {
        const storage = memoryStorage();
        armApplyReturn(storage, JOB_A, 0);
        armApplyReturn(storage, JOB_B, 1_000);

        const record = readApplyReturnRecord(storage);
        assert.equal(record?.jobId, JOB_B.jobId);

        // Returning now only ever surfaces job B — job A's arm was fully
        // overwritten, not queued behind it.
        const result = evaluateApplyReturn(storage, 1_000 + APPLY_RETURN_THRESHOLD_MS, neverApplied);
        assert.equal(result?.jobId, JOB_B.jobId);
    });
});
