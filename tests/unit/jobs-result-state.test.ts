import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
} from '../../src/lib/jobs/result-state';
import type { JobSearchResult, PublicJob } from '../../src/lib/jobs/types';

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

    // Task 11 review fix — the `wasConfirmed` option's full 2×2 matrix
    // (found-in-hits × wasConfirmed), the discrimination logic that keeps a
    // dead `?job=` id from being silently swapped for an unrelated
    // `hits[0]` before the existence check (page.tsx) gets to run. The
    // first two cases prove `found` wins regardless of `wasConfirmed`; the
    // last two prove `wasConfirmed` only matters once the id is missing.
    describe('wasConfirmed option', () => {
        it('found + wasConfirmed:true (default) — preserved, matches the no-opts case above', () => {
            assert.deepEqual(resolveSelectionAfterRefresh('second', hits, { wasConfirmed: true }), {
                selectedId: 'second',
                preserveDeliberateDetail: true,
            });
        });

        it('found + wasConfirmed:false — still preserved; presence in hits short-circuits before wasConfirmed is consulted', () => {
            assert.deepEqual(resolveSelectionAfterRefresh('second', hits, { wasConfirmed: false }), {
                selectedId: 'second',
                preserveDeliberateDetail: true,
            });
        });

        it('missing + wasConfirmed:true — Task 5\'s fallback: reassigns to hits[0], closes detail', () => {
            assert.deepEqual(resolveSelectionAfterRefresh('missing', hits, { wasConfirmed: true }), {
                selectedId: 'first',
                preserveDeliberateDetail: false,
            });
        });

        it('missing + wasConfirmed:false — Task 11\'s dead-link pass: preserves the id, keeps detail open', () => {
            assert.deepEqual(resolveSelectionAfterRefresh('missing', hits, { wasConfirmed: false }), {
                selectedId: 'missing',
                preserveDeliberateDetail: true,
            });
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

// Task 11 review fix — the dead-link existence check's response
// classification. Covered as a pure unit test rather than solely relying on
// e2e: verified LIVE against production (2026-07-19) that Meilisearch's `id`
// field is not filterable there yet (a 400 `invalid_search_filter` — the
// primary key is NOT automatically filterable, contrary to this function's
// first draft assumption) and the search-only key can't reach any
// alternative by-id endpoint (GET /documents/{id} and /indexes/{id} both
// 403 — out of the search-only key's scope). `searchMeili` surfaces that
// 400 as `configured:true` + an "unavailable" note, exactly the
// `unavailable-job-a-result` case this suite exercises, so the "unknown"
// case below is not hypothetical — it is what production currently returns
// for EVERY call until the live index gets `id` added to
// `filterableAttributes` (JOBS_INDEX_SETTINGS, lib/jobs/meilisearch.ts) and
// is re-provisioned. Until then the existence check is safely inert
// (renders neither a tombstone nor a false detail) rather than lying.
describe('classifyExistenceCheck', () => {
    const job = { id: 'abc-123', title: 'Staff Engineer' } as unknown as PublicJob;

    it('found: the id is in the result hits', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [job], total: 1 })),
            { status: 'found', job },
        );
    });

    it('not_found: a configured, successful search returned zero hits', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [], total: 0 })),
            { status: 'not_found' },
        );
    });

    it('unknown: an unconfigured backend never confirms or denies', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ configured: false, backend: 'unconfigured' })),
            { status: 'unknown' },
        );
    });

    it('unknown: a failed/unsupported filter request (the real production case today — `id` not yet filterable)', () => {
        assert.deepEqual(
            classifyExistenceCheck(
                'abc-123',
                result({ note: 'Job search is temporarily unavailable: Meilisearch search failed: 400 Attribute `id` is not filterable' }),
            ),
            { status: 'unknown' },
        );
    });
});
