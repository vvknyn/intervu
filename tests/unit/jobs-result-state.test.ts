import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isUnavailableJobsResult,
    isAuthoritativeResult,
    resolveSelectionAfterRefresh,
    resolveGhostReveal,
    classifyExistenceCheck,
    runExistenceCheck,
    resolveEmptySearchState,
    resolveJobsRenderMode,
    resolveJobsResultsPanel,
    holdSavedSearchAbovePanel,
    resolveEndOfListState,
    DEAD_JOB_TOMBSTONE_TEXT,
    shouldClearStaleJobUrl,
    usedDeadLinkPassBefore,
    shouldBackOnDetailSheetClose,
    resolveDetailMountSite,
    shouldSuppressLandingAmbientPreview,
    degradedResultsNote,
    employerElsewhereNote,
    buildZeroResultPayload,
    type SearchServedMeta,
} from '../../src/lib/jobs/result-state';
import type { EmptySearchStateInput } from '../../src/lib/jobs/result-state';
import type { JobSearchResult, PublicJob } from '../../src/lib/jobs/types';
import {
    PRISTINE_FILTER_STATE,
    facetValueLabel,
    postedBucketLabel,
    type FilterState,
} from '../../src/components/jobs/FilterPanel';

function result(
    overrides: Partial<JobSearchResult> & { descriptionPending?: boolean } = {},
): JobSearchResult & { descriptionPending?: boolean } {
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
            { status: 'found', job, descriptionPending: false },
        );
    });

    it('found: descriptionPending is carried through when the fill hit its deadline', () => {
        assert.deepEqual(
            classifyExistenceCheck('abc-123', result({ hits: [job], total: 1, descriptionPending: true })),
            { status: 'found', job, descriptionPending: true },
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

// `runExistenceCheck` is the chokepoint every id-scoped detail fetch (jobs/
// page.tsx's dead-job check + hydrate, yours/[id]/page.tsx's open + retry)
// goes through. `classifyExistenceCheck` above never sees a thrown request —
// this is what proves the added try/catch degrades it to "unknown" rather
// than letting the throw reach the caller, on top of delegating a resolved
// response to the exact same classification.
describe('runExistenceCheck', () => {
    const job = { id: 'abc-123', title: 'Staff Engineer' } as unknown as PublicJob;

    it('a thrown request resolves to unknown, never rejects', async () => {
        const search = async () => {
            throw new Error('network down');
        };
        assert.deepEqual(await runExistenceCheck('abc-123', search), { status: 'unknown' });
    });

    it('a resolved hit classifies found, carrying descriptionPending through', async () => {
        const search = async () => result({ hits: [job], total: 1, descriptionPending: true });
        assert.deepEqual(await runExistenceCheck('abc-123', search), {
            status: 'found',
            job,
            descriptionPending: true,
        });
    });

    it('a resolved, clean, empty result classifies not_found', async () => {
        const search = async () =>
            result({ backend: 'meilisearch', configured: true, hits: [], total: 0, note: undefined });
        assert.deepEqual(await runExistenceCheck('abc-123', search), { status: 'not_found' });
    });

    it('calls search with the fixed query shape — id, limit 1, offset 0, hideGhosts false', async () => {
        let received: unknown;
        const search = async (query: unknown) => {
            received = query;
            return result();
        };
        await runExistenceCheck('abc-123', search);
        assert.deepEqual(received, { id: 'abc-123', limit: 1, offset: 0, hideGhosts: false });
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

// A job opened from a shared link isn't in the list's first page, so it rides
// its one free pass. A dev server runs the fetch effect twice for the same
// search, and the second run spent the pass and closed the job (2026-10-01).
describe('usedDeadLinkPassBefore', () => {
    const pass = { id: 'shared-id', searchKey: 'posted=any' };

    it('the same search fetched again keeps the pass', () => {
        assert.equal(usedDeadLinkPassBefore(pass, 'shared-id', 'posted=any'), false);
    });

    it('a new search has used it up', () => {
        assert.equal(usedDeadLinkPassBefore(pass, 'shared-id', 'q=designer&posted=any'), true);
    });

    it('another id, no pass yet, or no selection: not used', () => {
        assert.equal(usedDeadLinkPassBefore(pass, 'other-id', 'q=designer'), false);
        assert.equal(usedDeadLinkPassBefore(null, 'shared-id', 'q=designer'), false);
        assert.equal(usedDeadLinkPassBefore(pass, null, 'q=designer'), false);
    });
});

describe('shouldBackOnDetailSheetClose', () => {
    it('user dismiss while job is still in the URL → back once', () => {
        assert.equal(shouldBackOnDetailSheetClose(false, 'job-1'), true);
    });

    it('reconcile already cleared job → do not pop search history again', () => {
        assert.equal(shouldBackOnDetailSheetClose(false, null), false);
    });

    it('sheet opening → never back', () => {
        assert.equal(shouldBackOnDetailSheetClose(true, 'job-1'), false);
    });
});

describe('shouldSuppressLandingAmbientPreview', () => {
    it('suppresses ambient preview on pristine landing below xl', () => {
        assert.equal(shouldSuppressLandingAmbientPreview(true, false), true);
    });

    it('allows ambient preview on pristine landing at xl+', () => {
        assert.equal(shouldSuppressLandingAmbientPreview(true, true), false);
    });

    it('does not suppress when not pristine landing', () => {
        assert.equal(shouldSuppressLandingAmbientPreview(false, false), false);
        assert.equal(shouldSuppressLandingAmbientPreview(false, true), false);
    });
});

// Two-Panel Selector (desktop split view) — the single mount-arbitration
// function both the Sheet's `open` prop and the xl+ pane's render condition
// derive from. Truth table below (4 combinations) plus a crossing case that
// proves mutual exclusion holds across a resize, not just at one width.
describe('resolveDetailMountSite', () => {
    it('SSR-initial: no matchMedia yet (isXlUp defaults false), nothing selected → none, results or not', () => {
        assert.equal(resolveDetailMountSite(false, false, false), 'none');
        assert.equal(resolveDetailMountSite(false, false, true), 'none');
    });

    it('SSR-initial with a job selected (deep link before hydration) → sheet, never pane', () => {
        assert.equal(resolveDetailMountSite(false, true, true), 'sheet');
    });

    it('hydrated at xl+ with results but no explicit open → pane (ambient auto-preview)', () => {
        assert.equal(resolveDetailMountSite(true, false, true), 'pane');
    });

    it('hydrated at xl+ with no results and no explicit open → none (nothing to preview)', () => {
        assert.equal(resolveDetailMountSite(true, false, false), 'none');
    });

    it('hydrated at xl+ with an explicit open → pane even with zero ambient hits (deep-linked job)', () => {
        assert.equal(resolveDetailMountSite(true, true, false), 'pane');
    });

    it('breakpoint crossing: widening past xl with the same live selection never yields sheet+pane both, or neither', () => {
        const belowXl = resolveDetailMountSite(false, true, true);
        const aboveXl = resolveDetailMountSite(true, true, true);
        // Exactly one mount site is live at a time, by construction — the
        // two `assert.equal` calls below already prove neither is "pane"
        // twice nor "sheet" twice across the crossing.
        assert.equal(belowXl, 'sheet');
        assert.equal(aboveXl, 'pane');
        assert.notEqual(belowXl, aboveXl);
    });

    it('below xl the ambient preview never opens the sheet: only an explicit open does', () => {
        assert.equal(resolveDetailMountSite(false, false, true), 'none');
    });
});

// Empty-search landing state (page.tsx's `showAsk` replacement) — an empty
// search must never list the whole corpus. Covers the three outcomes and the
// precedence between them (query/fit beats everything; filters decide which
// ask). Used to have a fourth outcome, "auto-explore", driven by `mode`/
// `hasUsableResume`/`isInitialLoad`/`exploreFailed` — removed 2026-08-02
// along with the "Explore" (AI-suggested adjacent roles) feature it drove.
describe('resolveEmptySearchState', () => {
    function input(overrides: Partial<EmptySearchStateInput> = {}): EmptySearchStateInput {
        return {
            hasQuery: false,
            fitActive: false,
            activeFilterCount: 0,
            hasCorpusScope: false,
            ...overrides,
        };
    }

    it('a real query always wins, regardless of everything else', () => {
        assert.equal(
            resolveEmptySearchState(input({ hasQuery: true, activeFilterCount: 2 })),
            'results',
        );
    });

    it('fitActive wins even with an empty query', () => {
        assert.equal(resolveEmptySearchState(input({ fitActive: true })), 'results');
    });

    it('no query, no filters — the plain first-screen overlay', () => {
        assert.equal(resolveEmptySearchState(input()), 'overlay-ask');
    });

    // Regression, measured locally 2026-08-16: "overlay-ask" is the one state
    // page.tsx serves from the CACHED, fixed-shape `getDefaultBrowseAction`,
    // which cannot carry the caller's params. A scoped visit that landed there
    // rendered the whole corpus (721,946 roles) beneath an "EMPLOYER
    // harrods.com" chip. Any corpus narrowing must therefore route through the
    // params-carrying fetch, whether it came from a company link or a board.
    it('a corpus scope with no query never lands on the cached default browse', () => {
        assert.equal(resolveEmptySearchState(input({ hasCorpusScope: true })), 'serp-ask');
    });

    it('a corpus scope still yields to a real query', () => {
        assert.equal(
            resolveEmptySearchState(input({ hasCorpusScope: true, hasQuery: true })),
            'results',
        );
    });

    it('filters-only (no query) — SERP-ask, not the full-screen overlay', () => {
        assert.equal(resolveEmptySearchState(input({ activeFilterCount: 1 })), 'serp-ask');
    });
});

// 2026-08-07 front-door reversal — browse-by-default's render decision.
// Zero query used to mean an un-fetched serp-ask no matter what; now a
// zero-query fetch's OWN outcome decides, per `resolveJobsRenderMode`'s doc
// comment. `outcome()` mirrors the `input()`/`result()` helpers above.
describe('resolveJobsRenderMode', () => {
    function outcome(overrides: Partial<{ loading: boolean; hitCount: number; failed: boolean }> = {}) {
        return { loading: false, hitCount: 0, failed: false, ...overrides };
    }

    it('a real query always renders results, regardless of the fetch outcome', () => {
        assert.equal(resolveJobsRenderMode('results', outcome({ failed: true })), 'results');
    });

    it('the exact surfaced scenario: zero query, browse fetch succeeded with hits → results, not serp-ask', () => {
        assert.equal(resolveJobsRenderMode('overlay-ask', outcome({ hitCount: 12 })), 'results');
    });

    it('zero query, browse fetch genuinely failed with nothing to show → serp-ask fallback', () => {
        assert.equal(resolveJobsRenderMode('overlay-ask', outcome({ failed: true })), 'serp-ask');
    });

    it('zero query, first-page fetch still in flight → results (renders the loading skeleton, never a flash of serp-ask)', () => {
        assert.equal(resolveJobsRenderMode('overlay-ask', outcome({ loading: true })), 'results');
    });

    it('zero query, no hits and no failure (a genuine zero-match browse) → results, not serp-ask — an empty result is not a failure', () => {
        assert.equal(resolveJobsRenderMode('overlay-ask', outcome()), 'results');
    });

    // Beyond the exact surfaced scenario — zero query WITH active filters
    // (`resolveEmptySearchState` classifies this "serp-ask", the uncached
    // filtered-fetch shape). Proves filters no longer block the front page
    // from showing real jobs once that fetch actually returns hits — the
    // whole point of the reversal, not just the pristine no-filter case.
    it('zero query WITH active filters, filtered fetch returned hits → results, not the ask fallback', () => {
        assert.equal(resolveJobsRenderMode('serp-ask', outcome({ hitCount: 4 })), 'results');
    });

    it('zero query WITH active filters, filtered fetch failed → serp-ask fallback, same as the no-filter case', () => {
        assert.equal(resolveJobsRenderMode('serp-ask', outcome({ failed: true })), 'serp-ask');
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

// The shared "complete AND authoritative" predicate — the one chokepoint
// `classifyExistenceCheck` (this file) and `describeResponseInit`
// (app/api/jobs/[id]/description/route.ts, whose own `HydrateDescriptionResult`
// is a `JobSearchResult` superset) both go through, so the client's existence
// check and the route's cache-control decision can never classify the same
// envelope differently.
describe('isAuthoritativeResult', () => {
    it('true for a clean, complete meilisearch result', () => {
        assert.equal(isAuthoritativeResult(result()), true);
    });

    it('false for a snapshot-preview or unconfigured backend — a capped/absent corpus is never authoritative', () => {
        assert.equal(isAuthoritativeResult(result({ backend: 'snapshot-preview' })), false);
        assert.equal(isAuthoritativeResult(result({ backend: 'unconfigured', configured: false })), false);
    });

    it('false when a note is present, even without the unavailable flag', () => {
        assert.equal(isAuthoritativeResult(result({ note: 'Some other degraded-mode note' })), false);
    });

    it('false when unavailable is set — a Meili-outage envelope', () => {
        assert.equal(isAuthoritativeResult(result({ unavailable: true })), false);
    });

    it('false when meta.degraded is set — a served-from-cache envelope, stale by construction', () => {
        assert.equal(isAuthoritativeResult(withMeta({ degraded: true, servedFrom: 'cache' })), false);
    });

    it('true when meta is present but not degraded, and true when meta is absent entirely', () => {
        assert.equal(isAuthoritativeResult(withMeta({ degraded: false, servedFrom: 'live' })), true);
        assert.equal(isAuthoritativeResult(result()), true);
    });
});

// A4 — the end-of-list line's honesty check. `hasMore` (page.tsx) already
// stops loading at BOTH ceilings (corpus exhausted, or MAX_REACHABLE hit);
// this is the render decision for what the line says once loading stops,
// covering the exact bug: a broad browse capped at MAX_REACHABLE=100,000
// hits.length while the honest resolved total (recovered via the
// ghost_badge facet-sum, corpus-count.ts) is ~1.7M — "reached the end —
// 1,704,771 roles" was printed early, lying by ~1.6M.
describe('resolveEndOfListState', () => {
    it('genuine end: hits caught up with a small, honest total — the ordinary case', () => {
        assert.equal(
            resolveEndOfListState({ hitsLength: 42, total: 42, maxReachable: 100_000 }),
            'genuine-end',
        );
    });

    it('cap reached: the exact surfaced bug — stopped at MAX_REACHABLE while the honest total is far bigger', () => {
        assert.equal(
            resolveEndOfListState({ hitsLength: 100_000, total: 1_704_771, maxReachable: 100_000 }),
            'cap-reached',
        );
    });

    it('boundary: total equals maxReachable exactly — resolves genuine-end, never a cap claim with no bigger number to show', () => {
        assert.equal(
            resolveEndOfListState({ hitsLength: 100_000, total: 100_000, maxReachable: 100_000 }),
            'genuine-end',
        );
    });

    it('mid-list: still loading, neither ceiling reached — not a caller this function normally sees, but resolves honestly anyway', () => {
        assert.equal(
            resolveEndOfListState({ hitsLength: 30, total: 5_000, maxReachable: 100_000 }),
            'more-available',
        );
    });
});

describe('resolveJobsResultsPanel', () => {
    const panel = (over: Partial<Parameters<typeof resolveJobsResultsPanel>[0]> = {}) =>
        resolveJobsResultsPanel({
            isSerpAsk: false,
            notConnected: false,
            blockingError: false,
            loading: false,
            hitCount: 0,
            ...over,
        });

    it('a zero-hit fetch with no other signal resolves to the empty panel', () => {
        assert.equal(panel({ hitCount: 0 }), 'empty');
    });

    it('the ask state wins regardless of the other flags', () => {
        assert.equal(panel({ isSerpAsk: true }), 'serp-ask');
    });

    it('a non-zero hit count resolves to the list panel', () => {
        assert.equal(panel({ hitCount: 24 }), 'list');
    });

    it('loading resolves to the loading panel regardless of prior hits — stale rows are hidden during any refresh', () => {
        assert.equal(panel({ loading: true }), 'loading');
        assert.equal(panel({ loading: true, hitCount: 5 }), 'loading');
    });

    it('panel precedence matches the ternary it replaced: ask beats backend states, which beat loading, which beats empty', () => {
        assert.equal(panel({ isSerpAsk: true, notConnected: true, blockingError: true, loading: true }), 'serp-ask');
        assert.equal(panel({ notConnected: true, blockingError: true, loading: true }), 'not-connected');
        assert.equal(panel({ blockingError: true, loading: true }), 'error');
    });
});

describe('holdSavedSearchAbovePanel', () => {
    const step = (panel: Parameters<typeof holdSavedSearchAbovePanel>[0], held: boolean) =>
        holdSavedSearchAbovePanel(panel, held);

    it('the first splash mounts nothing, then an empty panel does, and the next splash keeps that same row', () => {
        const first = step('loading', false);
        assert.equal(first.show, false);
        const empty = step('empty', first.held);
        assert.equal(empty.show, true);
        const refetch = step('loading', empty.held);
        assert.equal(refetch.show, true, 'a support-probe refetch must not remount the row');
        assert.equal(step('empty', refetch.held).show, true);
    });

    it('a list and the splash that follows it leave the above-panel row off', () => {
        const list = step('list', false);
        assert.equal(list.show, false);
        assert.equal(list.held, false);
        const splash = step('loading', list.held);
        assert.equal(splash.show, false);
        assert.equal(step('list', splash.held).show, false);
    });

    it('a settled non-list panel turns the hold on, and a later list turns it off', () => {
        for (const panel of ['serp-ask', 'not-connected', 'error', 'empty'] as const) {
            const settled = step(panel, false);
            assert.equal(settled.show, true, panel);
            assert.equal(settled.held, true, panel);
        }
        const back = step('list', true);
        assert.equal(back.show, false);
        assert.equal(back.held, false);
    });
});

describe('buildZeroResultPayload', () => {
    it('names every active facet (key only, never its value) for a multi-facet zero-result search — the reported "Software Engineer" + location + posted-date bug shape', () => {
        const state: FilterState = {
            ...PRISTINE_FILTER_STATE,
            facets: { location_country: ['CA'] },
            postedBucket: '7d',
        };
        const payload = buildZeroResultPayload(state, 'Software Engineer', {});
        assert.equal(payload.query_length, 'Software Engineer'.length);
        assert.equal(payload.filter_count, 2);
        assert.deepEqual(
            new Set(payload.active_facets),
            new Set(['location_country', 'postedBucket']),
        );
    });

    it('surfaces a facet never named anywhere in the builder itself — proves the derivation is generic, not an enumerated list (covers a facet OTHER than the one that motivated this change)', () => {
        const state: FilterState = {
            ...PRISTINE_FILTER_STATE,
            facets: { tech_stack: ['rust'] },
            postedBucket: undefined,
        };
        const payload = buildZeroResultPayload(state, 'engineer', {});
        assert.deepEqual(payload.active_facets, ['tech_stack']);
        assert.equal(JSON.stringify(payload).includes('rust'), false, 'a facet value never leaves the browser');
    });

    it('names a silently-applied default (pristine 90d posted bucket) in active_facets even though filter_count — the pre-existing dashboard contract — still excludes it', () => {
        const payload = buildZeroResultPayload(PRISTINE_FILTER_STATE, 'nurse', {});
        assert.equal(payload.filter_count, 0);
        assert.deepEqual(payload.active_facets, ['postedBucket']);
    });

    it('never emits the raw typed query text anywhere in the payload — only its length', () => {
        const state: FilterState = { ...PRISTINE_FILTER_STATE, facets: { location_country: ['CA'] }, postedBucket: '7d' };
        const typed = 'a very specific typed phrase nobody else would type';
        const payload = buildZeroResultPayload(state, typed, {});
        assert.equal(JSON.stringify(payload).includes(typed), false);
        assert.equal(payload.query_length, typed.length);
    });

    it('passes through the IP default country when the search response carried one, and never a typed place', () => {
        const payload = buildZeroResultPayload(PRISTINE_FILTER_STATE, 'engineer', {
            defaultedLocation: 'US',
            unmatchedPlaceMentions: ['North America'],
        } as Parameters<typeof buildZeroResultPayload>[2]);
        assert.equal(payload.defaulted_location, 'US');
        assert.equal(JSON.stringify(payload).includes('North America'), false, 'typed place text stays in the anonymous search log');
    });

    it('reports no location resolution rather than fabricating one when the response carried none', () => {
        const payload = buildZeroResultPayload(PRISTINE_FILTER_STATE, 'engineer', {});
        assert.equal(payload.defaulted_location, null);
    });
});

describe('employerElsewhereNote', () => {
    it('says nothing when no place was asked for or every row is in it', () => {
        assert.equal(employerElsewhereNote(undefined, 40), null);
        assert.equal(employerElsewhereNote(340, 340), null);
        assert.equal(employerElsewhereNote(0, 0), null);
    });

    it('says the whole list is from elsewhere when none of it is in the place', () => {
        assert.match(employerElsewhereNote(0, 29) ?? '', /No roles at this employer match your location/);
        assert.match(employerElsewhereNote(0, 9049) ?? '', /roles elsewhere/);
    });

    it('says how many roles lead in the place before the rest', () => {
        assert.equal(
            employerElsewhereNote(12, 133),
            "Showing 12 roles in your location first, then this employer's roles elsewhere.",
        );
        assert.match(employerElsewhereNote(1, 40) ?? '', /^Showing 1 role in your location first/);
    });
});
