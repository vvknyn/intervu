import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPromptApplyReturn, APPLY_RETURN_THRESHOLD_MS } from '../../src/lib/jobs/apply-return';

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
