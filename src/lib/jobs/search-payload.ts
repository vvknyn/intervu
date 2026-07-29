import type { FilterState } from "@/components/jobs/FilterPanel";
import type { BoardId } from "@/lib/boards/types";
import type { JobSearchParams, JobSortMode } from "@/lib/jobs/types";

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
 */
export function buildJobSearchPayload(
    state: FilterState,
    query: string,
    sort: JobSortMode | null | undefined,
    postedDateSupported: boolean,
    board: BoardId | null | undefined,
): Pick<JobSearchParams, "q" | "facets" | "salaryMin" | "visaOnly" | "postedBucket" | "hideGhosts" | "sort" | "board"> {
    return {
        q: query.trim() || undefined,
        facets: state.facets,
        salaryMin: state.salaryMin || undefined,
        visaOnly: state.visaOnly || undefined,
        postedBucket: postedDateSupported ? state.postedBucket : undefined,
        hideGhosts: state.hideGhosts,
        sort: sort ?? undefined,
        board: board ?? undefined,
    };
}
