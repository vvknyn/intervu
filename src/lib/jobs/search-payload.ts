import type { FilterState } from "@/components/jobs/FilterPanel";
import { appliedPostedBucket } from "@/components/jobs/FilterPanel";
import type { JobSearchParams, JobSortMode, PostedBucket } from "@/lib/jobs/types";
import { urlSortToMode, type JobsUrlState, type UrlSort } from "@/lib/jobs/url-state";

/**
 * The ONE place that turns (FilterState, query, sort) into the shared subset
 * of a `searchJobsAction` payload — `q`/`facets`/`salaryMin`/`visaOnly`/
 * `postedBucket`/`hideGhosts`/`sort`, with the exact per-field conversions
 * `searchJobsAction` expects (empty query → `undefined`, `0`/`false` →
 * `undefined`). Callers spread this and add whatever varies per request —
 * `limit`/`offset`/`withFacets` — on top.
 *
 * Review fix (2026-07-19): before this existed, page.tsx's live search, its
 * ghost-hidden-count probe, and Task 10's mobile sheet live count each
 * hand-built this same payload separately. That's the exact duplication
 * class `toggleFacetValue` was extracted to prevent for facet toggling, just
 * relocated to the search-params layer — a field the live search gains
 * later could silently go missing from a probe request, and the sheet's
 * "Show N roles" button could promise a number applying wouldn't produce.
 * Now every one of those call sites (page.tsx) builds its request from this
 * function plus its own request-specific fields.
 *
 * Whole-branch review fix — `loadMore`'s infinite-scroll fetch was a FOURTH
 * hand-built copy of this same subset that slipped in after the above
 * review fix landed, missed by the "every one of those call sites"
 * invariant this comment itself asserts. Fields were identical to this
 * function's output at the time, but nothing enforced that staying true —
 * `loadMore` now builds from this function too, so all four call sites can
 * no longer drift from each other.
 *
 * `postedDateSupported` (Phase 1-a): whether the corpus can currently back
 * `postedBucket` with real data (see `fetchPostedDateFilterSupported`). A
 * `postedBucket` can be sitting in `state` from a stale URL/bookmark even
 * when the corpus can't answer it — the picker UI already hides itself in
 * that case (`postedDateSupported` gates `FilterPanel`/`FilterChipsRow`
 * too), but the REQUEST needs the same gate: `buildFilter` in
 * meilisearch.ts honors `postedBucket` unconditionally, so an ungated
 * request would range-filter over a field with ~no data and silently
 * 0-result every hit. Same signal, same chokepoint, so the picker and the
 * request can never disagree about whether the bucket is real.
 *
 * The fresh-visit `90d` default IS a real request filter (product default —
 * see `DEFAULT_URL_STATE.postedBucket`, url-state.ts); only an explicit
 * "Any date" lifts it. WHICH window is in force is `appliedPostedBucket`'s
 * call (FilterPanel), shared with every control that draws one; this adds
 * only the corpus-support gate, the one concern the pickers don't have.
 */
export function effectivePostedBucket(
    state: Pick<FilterState, "postedBucket" | "postedExplicit">,
    postedDateSupported: boolean,
): PostedBucket | undefined {
    return postedDateSupported ? appliedPostedBucket(state) : undefined;
}

export function buildJobSearchPayload(
    state: FilterState,
    query: string,
    sort: JobSortMode | null | undefined,
    postedDateSupported: boolean,
    /** The searcher dismissed the default-location chip (persisted client-
     *  side, JobsPage) — carried through so page 2+/probe requests never
     *  silently re-apply a default the searcher already cleared. */
    suppressLocationDefault?: boolean,
): Pick<
    JobSearchParams,
    | "q" | "facets" | "salaryMin" | "visaOnly" | "postedBucket" | "yearsExperience" | "hideGhosts" | "sort"
    | "board" | "companyDomain" | "suppressLocationDefault"
> {
    return {
        q: query.trim() || undefined,
        facets: state.facets,
        salaryMin: state.salaryMin || undefined,
        visaOnly: state.visaOnly || undefined,
        postedBucket: effectivePostedBucket(state, postedDateSupported),
        yearsExperience: state.yearsExperience,
        hideGhosts: state.hideGhosts,
        sort: sort ?? undefined,
        // Corpus scope rides in on `state` like every other narrowing. It used
        // to arrive as a separate `scope` argument, on the reasoning that a
        // curated board / single-employer slice is "not a user-picked filter".
        // That split is what let `board=elite` cap every search invisibly
        // (2026-08-24): a second home for "what narrows this?" meant the chips,
        // the clears and the pristine check all read one of them and missed the
        // other. One collection now, so drift is not expressible.
        board: state.board ?? undefined,
        companyDomain: state.companyDomain ?? undefined,
        suppressLocationDefault: suppressLocationDefault || undefined,
    };
}

/**
 * The backend sort a URL `sort` value resolves to. `fit` is a client-side
 * reorder of the relevance results, so it sends no override: with a query,
 * `resolveEffectiveSort` (sort.ts) lands on relevance by itself.
 */
export function urlSortToBackendSort(sort: UrlSort | null): JobSortMode | null {
    if (!sort) return null;
    const mode = urlSortToMode(sort);
    return mode === "fit" ? null : mode;
}

/** A `/jobs` URL state as the search payload `/jobs` itself would send for it. */
export function searchParamsFromUrlState(
    state: JobsUrlState,
    postedDateSupported = true,
    suppressLocationDefault?: boolean,
): ReturnType<typeof buildJobSearchPayload> & Pick<JobSearchParams, "fromResume"> {
    const payload = buildJobSearchPayload(
        state,
        state.q,
        urlSortToBackendSort(state.sort),
        postedDateSupported,
        suppressLocationDefault,
    );
    // `sort=fit` is a résumé's own query (`packFilters`): searched, never logged.
    return state.sort === "fit" ? { ...payload, fromResume: true } : payload;
}

/**
 * The extra params a résumé's own pack search carries: the phrases its skills show, so the pool holds the
 * postings that ask for them whatever their title (`JobSearchParams.contentPhrases`), and the remote roles
 * that name no country (`unplacedRemote`). Nothing for a search someone typed.
 */
export function resumeContentMark(
    fitActive: boolean,
    query: string,
    pack: { q: string; phrases: readonly string[] } | null,
): Pick<JobSearchParams, "contentPhrases" | "unplacedRemote"> {
    // Only the résumé pack's own search: a query typed beside Rank by fit is looked up as typed.
    if (!fitActive || !pack || query.trim() !== pack.q) return {};
    return packContentMark(pack.phrases, true);
}

export function packContentMark(phrases: readonly string[], unplacedRemote: boolean): Pick<JobSearchParams, "contentPhrases" | "unplacedRemote"> {
    if (phrases.length === 0) return {};
    return { contentPhrases: [...phrases], ...(unplacedRemote ? { unplacedRemote: true } : {}) };
}

/**
 * A fit-ranked or pack search's query is the résumé's own role titles: marked so the search log leaves it
 * out (`shouldLogSearch`), and, unless the résumé shows a role past Senior, so roles past Senior are left
 * out of its pool (`omitPastSenior`, types.ts). Shared by the board and the tests that search by hand.
 */
export function resumeSearchMark(
    fromResume: boolean,
    holdsResume = false,
    keepPastSenior = false,
): Pick<JobSearchParams, "fromResume" | "omitPastSenior" | "jdTerms"> {
    if (fromResume) return keepPastSenior ? { fromResume: true } : { fromResume: true, omitPastSenior: true };
    // Rows this browser will score against a résumé carry their description's terms (jd-terms.ts).
    return holdsResume ? { jdTerms: true } : {};
}
