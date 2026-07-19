import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
} from '../../src/lib/jobs/result-state';
import type { JobSearchResult } from '../../src/lib/jobs/types';

function result(overrides: Partial<JobSearchResult> = {}): JobSearchResult {
    return {
        hits: [],
        total: 0,
        backend: 'meilisearch',
        configured: true,
        ...overrides,
    };
}

describe('isUnavailableJobsResult', () => {
    it('classifies a configured service-unavailable response as an error', () => {
        assert.equal(
            isUnavailableJobsResult(
                result({ note: 'Job search is temporarily unavailable: upstream timed out' }),
            ),
            true,
        );
    });

    it('does not classify a valid empty result as unavailable', () => {
        assert.equal(isUnavailableJobsResult(result()), false);
    });

    it('does not replace existing hits with an unavailable response', () => {
        assert.equal(
            isUnavailableJobsResult(
                result({
                    hits: [{ id: 'existing' } as JobSearchResult['hits'][number]],
                    note: 'Job search is temporarily unavailable',
                }),
            ),
            false,
        );
    });

    it('keeps the unconfigured backend distinct from service errors', () => {
        assert.equal(
            isUnavailableJobsResult(
                result({
                    backend: 'unconfigured',
                    configured: false,
                    note: "Job search isn't connected yet.",
                }),
            ),
            false,
        );
    });
});

describe('resolveSelectionAfterRefresh', () => {
    const hits = [{ id: 'first' }, { id: 'second' }];

    it('preserves a valid selection and an open deliberate detail', () => {
        assert.deepEqual(resolveSelectionAfterRefresh('second', hits), {
            selectedId: 'second',
            preserveDeliberateDetail: true,
        });
    });

    it('selects the first replacement but closes deliberate detail when selection disappeared', () => {
        assert.deepEqual(resolveSelectionAfterRefresh('missing', hits), {
            selectedId: 'first',
            preserveDeliberateDetail: false,
        });
    });

    it('clears selection and closes deliberate detail for zero hits', () => {
        assert.deepEqual(resolveSelectionAfterRefresh('first', []), {
            selectedId: null,
            preserveDeliberateDetail: false,
        });
    });
});

// Task 11 — empty-state ghost-reveal line gating. Covered as a pure unit
// test rather than a third e2e case: the e2e suite runs against a real,
// changing Meilisearch-backed corpus (see this file's own header comment),
// and there's no filter combination that reliably guarantees "zero non-ghost
// hits AND a positive hidden-ghost count" on live data — so the render-gating
// RULE is proven here instead, the same way `isUnavailableJobsResult` and
// `resolveSelectionAfterRefresh` above cover their own branches directly.
describe('resolveGhostReveal', () => {
    it('surfaces the count when ghosts are hidden and the count is positive', () => {
        assert.equal(resolveGhostReveal(true, 12), 12);
    });

    it('stays null while the count is unresolved', () => {
        assert.equal(resolveGhostReveal(true, null), null);
    });

    it('stays null when the hidden count is exactly zero', () => {
        assert.equal(resolveGhostReveal(true, 0), null);
    });

    it('stays null once ghosts are shown, even with a stale positive count', () => {
        assert.equal(resolveGhostReveal(false, 12), null);
    });
});
