import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isUnavailableJobsResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
    resolveEmptySearchState,
    DEAD_JOB_TOMBSTONE_TEXT,
    shouldClearStaleJobUrl,
    degradedResultsNote,
    type SearchServedMeta,
} from '../../src/lib/jobs/result-state';
import type { EmptySearchStateInput } from '../../src/lib/jobs/result-state';
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
                result({ unavailable: true, note: "The search index didn't respond." }),
            ),
            true,
        );
    });

    it('classifies on the flag regardless of note wording — or with no note at all', () => {
        assert.equal(isUnavailableJobsResult(result({ unavailable: true })), true);
        assert.equal(
            isUnavailableJobsResult(result({ note: 'Job search is temporarily unavailable' })),
            false,
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
                    unavailable: true,
                    note: "The search index didn't respond.",
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

    // Review fix — hits present but NONE match the requested id: a sign the
    // query got mis-scoped (e.g. the `id` filter silently didn't apply and
    // a broader search ran instead) rather than proof the role is gone.
    // `isCompleteAndClean` already requires `hits.length === 0`, which this
    // fails, but that branch previously had no direct test of its own.
    it('unknown: hits present but none match the id — a mis-scoped query is not proof of absence', () => {
        const other = { id: 'other-id', title: 'Unrelated Role' } as unknown as PublicJob;
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [other], total: 1 })),
            { status: 'unknown' },
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

    // Review fix — the class of cases the fail-open bug missed: `not_found`
    // must require POSITIVE proof (complete backend + clean + empty), never
    // fall out as the default for "not an obviously-recognized error."
    it('unknown: snapshot-preview backend with zero hits — a capped SUBSET missing an id is not proof of absence', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ backend: 'snapshot-preview', hits: [], total: 0 })),
            { status: 'unknown' },
        );
    });

    it('unknown: configured + empty + an UNRECOGNIZED note — any note at all withholds not_found, not just the "temporarily unavailable" shape', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [], total: 0, note: 'Some other degraded-mode note' })),
            { status: 'unknown' },
        );
    });

    it('unknown: the unavailable flag alone (no note) also withholds not_found', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [], total: 0, unavailable: true })),
            { status: 'unknown' },
        );
    });

    it('not_found: meilisearch + empty + no note is the ONLY combination that proves absence', () => {
        assert.deepEqual(
            classifyExistenceCheck(
                'abc-123',
                result({ backend: 'meilisearch', configured: true, hits: [], total: 0, note: undefined }),
            ),
            { status: 'not_found' },
        );
    });
});

// Review fix — the mandated tombstone copy (controller resolution #1,
// verbatim) is only exercised in e2e via an `.or()` alongside the
// non-assertive state's own text (a dead id may classify either way against
// the live corpus — see jobs-first-screen.spec.ts), which alone could keep
// passing even if this exact string silently drifted. Pinned directly here.
describe('DEAD_JOB_TOMBSTONE_TEXT', () => {
    it('matches the controller-mandated copy exactly — no date, no guessed cause', () => {
        assert.equal(DEAD_JOB_TOMBSTONE_TEXT, 'This role is no longer available.');
    });
});

// Round-3 review fix — proves the corrected predicate can actually be true.
// The shipped-but-dead version of this logic (`!wasConfirmed &&
// alreadyUsedItsPass` inline in page.tsx) was a contradiction against its
// own `wasConfirmed = wasConfirmedBeforeThisFetch || alreadyUsedItsPass`
// definition and could never fire — reported fixed while being permanently
// unreachable. This full 2×2 matrix is the concrete, mechanical check that
// would have caught it: case 1 below is the ONLY one that's `true`, and it
// corresponds exactly to "an id already used its pass and is still missing."

// Whole-branch review finding: a filter change that excludes an
// already-open, previously-CONFIRMED job reassigns the selection
// (`preserveDeliberateDetail: false`) WITHOUT ever touching the free-pass
// machinery the narrower dead-link predicate guarded — that job was confirmed on its
// very first look, so `alreadyUsedItsPass` is always false for it, and the
// narrow predicate above can never fire. Before this predicate existed, that
// left `job=<excluded-id>` stuck in the address bar with no code path that
// would ever clear it — this is the coverage that catches it: a test using
// that narrow predicate's `(false, false)` for this exact
// scenario returns `false` (see above, "pass not yet used, still missing" —
// wrongly, for this case), which is exactly the bug. `shouldClearStaleJobUrl`
// is the general predicate the fetch effect now calls instead.
describe('shouldClearStaleJobUrl', () => {
    it('reassigned away + URL still names the old id → clear (the filter-excludes-open-job bug)', () => {
        assert.equal(shouldClearStaleJobUrl('excluded-id', 'excluded-id', false), true);
    });

    it('reassigned away + URL already names something else (e.g. a fresh openJob push mid-flight) → do not clear', () => {
        assert.equal(shouldClearStaleJobUrl('some-other-id', 'excluded-id', false), false);
    });

    it('reassigned away + URL has no job param at all (ambient browsing, e.g. keyboard-nav-only selection) → do not clear', () => {
        assert.equal(shouldClearStaleJobUrl(null, 'excluded-id', false), false);
    });

    it('selection preserved (still found, or a granted free pass) → nothing to clear even if the URL matches', () => {
        assert.equal(shouldClearStaleJobUrl('id-1', 'id-1', true), false);
    });

    it('no previous selection at all → nothing to clear', () => {
        assert.equal(shouldClearStaleJobUrl(null, null, false), false);
    });

    it('subsumes the dead-link-used-its-pass case: reassigned away, URL still names the dead id', () => {
        assert.equal(shouldClearStaleJobUrl('dead-id', 'dead-id', false), true);
    });
});

// Empty-search landing state (page.tsx's `showAsk` replacement) — an empty
// search must never list the whole corpus. Covers the four outcomes and the
// precedence between them (mode/query/fit beats everything; a prior
// exploreFailed beats a fresh auto-explore attempt; auto-explore beats both
// asks; filters decide which ask).
describe('resolveEmptySearchState', () => {
    function input(overrides: Partial<EmptySearchStateInput> = {}): EmptySearchStateInput {
        return {
            hasQuery: false,
            fitActive: false,
            mode: 'browse',
            activeFilterCount: 0,
            hasUsableResume: false,
            isInitialLoad: true,
            exploreFailed: false,
            ...overrides,
        };
    }

    it('a real query always wins, regardless of everything else', () => {
        assert.equal(
            resolveEmptySearchState(input({ hasQuery: true, activeFilterCount: 2, hasUsableResume: true })),
            'results',
        );
    });

    it('fitActive wins even with an empty query', () => {
        assert.equal(resolveEmptySearchState(input({ fitActive: true })), 'results');
    });

    it('explore mode always wins, even with an empty query and no filters', () => {
        assert.equal(resolveEmptySearchState(input({ mode: 'explore' })), 'results');
    });

    it('no query, no filters, no résumé — the plain first-screen overlay', () => {
        assert.equal(resolveEmptySearchState(input()), 'overlay-ask');
    });

    it('filters-only (no query, no résumé) — SERP-ask, not the full-screen overlay', () => {
        assert.equal(resolveEmptySearchState(input({ activeFilterCount: 1 })), 'serp-ask');
    });

    it('initial load + usable résumé — auto-explore, even with zero filters active', () => {
        assert.equal(
            resolveEmptySearchState(input({ isInitialLoad: true, hasUsableResume: true })),
            'auto-explore',
        );
    });

    it('initial load + usable résumé + filters active — auto-explore still wins over serp-ask', () => {
        assert.equal(
            resolveEmptySearchState(
                input({ isInitialLoad: true, hasUsableResume: true, activeFilterCount: 3 }),
            ),
            'auto-explore',
        );
    });

    it('résumé usable but NOT initial load (an in-session query clear already happened) — falls to serp-ask with filters active', () => {
        assert.equal(
            resolveEmptySearchState(
                input({ isInitialLoad: false, hasUsableResume: true, activeFilterCount: 1 }),
            ),
            'serp-ask',
        );
    });

    it('résumé usable but NOT initial load, no filters either — falls to the plain overlay ask', () => {
        assert.equal(
            resolveEmptySearchState(input({ isInitialLoad: false, hasUsableResume: true })),
            'overlay-ask',
        );
    });

    it('exploreFailed beats a fresh auto-explore candidacy — no infinite retry loop', () => {
        assert.equal(
            resolveEmptySearchState(
                input({ isInitialLoad: true, hasUsableResume: true, exploreFailed: true }),
            ),
            'serp-ask',
        );
    });

    it('exploreFailed with no filters active still lands on serp-ask (the seeded ask), not the bare overlay', () => {
        assert.equal(
            resolveEmptySearchState(input({ exploreFailed: true, activeFilterCount: 0 })),
            'serp-ask',
        );
    });
});

// Deliverable 1 — `meta` is an additive field the data-plane lane (branch
// feat/2026-08-01/p0-data-plane) is adding to `JobSearchResult`, not yet
// declared on the type this test file imports. Attaching it via a cast
// mirrors exactly how `degradedResultsNote` itself reads it (see
// `servedMeta` in result-state.ts) — real prod responses will carry the
// field the same way once that lane merges.
function withMeta(meta: SearchServedMeta): JobSearchResult {
    return { ...result(), meta } as JobSearchResult & { meta: SearchServedMeta };
}

describe('degradedResultsNote', () => {
    it('is null for a live (non-degraded) result', () => {
        assert.equal(
            degradedResultsNote(withMeta({ degraded: false, servedFrom: 'live' })),
            null,
        );
    });

    it('is null when meta is absent entirely — absence reads as live, never as degraded', () => {
        assert.equal(degradedResultsNote(result()), null);
    });

    it('is a calm, non-blocking note when degraded — results still rendered, just captioned', () => {
        assert.equal(
            degradedResultsNote(withMeta({ degraded: true, servedFrom: 'cache', cachedAtMs: Date.now() })),
            'Showing recent results — live search is catching up.',
        );
    });

    it('degraded without a cachedAtMs still yields the note — that field is optional', () => {
        assert.equal(
            degradedResultsNote(withMeta({ degraded: true, servedFrom: 'cache' })),
            'Showing recent results — live search is catching up.',
        );
    });
});
