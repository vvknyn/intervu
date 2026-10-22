/**
 * Pure sort resolution shared by Meilisearch and snapshot-preview backends.
 * Keeps auto-default, relevance-without-query normalization, and salary_desc
 * semantics in one place so unit tests can lock behavior without HTTP mocks.
 */
import { derivePostedTs } from "./meilisearch";
import { decodeText, titleMatchesQuery } from "./presentation";
import type { JobSearchParams, JobSortMode, PublicJob } from "./types";
import { resolveEffectiveSort } from "./sort-mode";

// Pure and import-free, so /jobs's route gate can build the first search
// without pulling this module's Meilisearch helpers into the page's first load.
export { coerceSortToSupported, resolveEffectiveSort } from "./sort-mode";

/** Meilisearch sort array for a search request. `legacy` uses posted_at instead of posted_ts. */
/**
 * The one label source for a `JobSortMode`, shared by every surface that
 * names a sort option (desktop's "Sort: {label}" trigger + its
 * DropdownMenuItems, the mobile filter sheet's ToolbarSegment tabs) so a
 * casing/wording fix made in one place can't drift out of sync with a
 * re-typed copy elsewhere — the mobile-tabs-were-lowercase defect was
 * exactly that: a second, hand-typed set of these strings.
 */
export function sortOptionLabel(mode: JobSortMode, resumeOnFile: boolean | null): string {
    switch (mode) {
        case "newest":
            return "Freshest";
        case "salary_desc":
            return "Top pay";
        case "relevance":
            return resumeOnFile === true ? "Best match" : "Relevance";
    }
}

/**
 * The sort trigger's label: "Best match" only when the list is actually ranked by the résumé fit; a résumé user
 * on plain relevance sees "Relevance", so the label never claims a ranking the list does not have.
 */
export function sortTriggerLabel(mode: JobSortMode, resumeOnFile: boolean | null, fitActive: boolean): string {
    if (fitActive) return "Best match";
    return mode === "relevance" && resumeOnFile === true ? "Relevance" : sortOptionLabel(mode, resumeOnFile);
}

export function buildMeiliSort(p: JobSearchParams, legacy = false): string[] | undefined {
    const mode = resolveEffectiveSort(p);
    const tsField = legacy ? "posted_at" : "posted_ts";
    switch (mode) {
        case "newest":
            return [`${tsField}:desc`];
        case "salary_desc":
            return ["salary_max:desc", "salary_min:desc"];
        case "relevance":
            return undefined;
    }
}

/**
 * Under an explicit non-relevance sort with a query, titled vs mention hits
 * interleave by date/pay. This flag drives the client seam
 * (`partitionByTitleMatch`) and the sort-integrity titled subsequence
 * (`sortVerifiableHits`) — display and monotonicity checks, not retrieval.
 * Retrieval is title/company/tags-scoped for a bare role query
 * (`titleFirstScoped`, `buildSearchBody`) under EVERY sort including
 * relevance, and similarly scoped for a company or tech-skill query — but a
 * non-title hit can still surface: tech-skill scoping admits `description`
 * matches, and a scoped pass that returns zero hits falls back to one
 * whole-document expand pass (`shouldRelaxSearch`/`mergeExpandedIntoStrict`
 * in meilisearch.ts). This flag still partitions those for display.
 *
 * Classified by `mode`, not by enumerating sort names: any resolved sort
 * OTHER than `"relevance"` is an explicit global ordering. A bare browse
 * (`q` empty) is untouched — there is no query text to partition on.
 */
export function shouldScopeTextMatchToTitle(mode: JobSortMode, q: string | undefined): boolean {
    return mode !== "relevance" && Boolean((q ?? "").trim());
}

export function jobTopSalary(j: PublicJob): number | null {
    return j.salary_max ?? j.salary_min ?? null;
}

/**
 * Compare two jobs for snapshot-preview client-side sorting.
 * Relevance cannot replicate Meili ranking — we keep filtered order stable via posted_ts desc.
 * Null salaries always sort last for salary_desc.
 */
export function compareJobsBySort(a: PublicJob, b: PublicJob, mode: JobSortMode): number {
    if (mode === "salary_desc") {
        const maxA = a.salary_max;
        const maxB = b.salary_max;
        const minA = a.salary_min;
        const minB = b.salary_min;
        const hasA = maxA != null || minA != null;
        const hasB = maxB != null || minB != null;
        if (!hasA && !hasB) return 0;
        if (!hasA) return 1;
        if (!hasB) return -1;
        const cmpMax = (maxB ?? minB ?? 0) - (maxA ?? minA ?? 0);
        if (cmpMax !== 0) return cmpMax;
        const cmpMin = (minB ?? maxB ?? 0) - (minA ?? maxA ?? 0);
        if (cmpMin !== 0) return cmpMin;
    }
    return (derivePostedTs(b) ?? 0) - (derivePostedTs(a) ?? 0);
}

/**
 * Pairwise check that a page of hits is already in the order `mode` implies.
 * This is the sort-integrity guard's read on whether Meilisearch actually
 * finished applying the requested `sort` — `searchCutoffMs` (JOBS_INDEX_SETTINGS,
 * meilisearch.ts) can interrupt a slow search under embed-batch/indexing load
 * and return partial results with the sort only PARTIALLY applied (8
 * order-restarts observed in one 40-hit "newest" page, 2026-08-14 incident).
 * Ties are allowed — `compareJobsBySort` returning 0 must not flag disorder,
 * since bulk-ingested documents legitimately share one posted_ts millisecond.
 */
export function isPageSorted(hits: PublicJob[], mode: JobSortMode): boolean {
    for (let i = 1; i < hits.length; i++) {
        if (compareJobsBySort(hits[i - 1], hits[i], mode) > 0) return false;
    }
    return true;
}

/**
 * The subsequence of `hits` whose order the sort-integrity guard
 * (`applySortIntegrityGuard`, meilisearch.ts) can actually hold to a
 * monotonic promise.
 *
 * 2026-08-14: `typo` now sits ahead of `sort` in `rankingRules`
 * (JOBS_INDEX_SETTINGS docblock, meilisearch.ts) — Meilisearch applies rules
 * strictly lexicographically, so the result set is fully partitioned into
 * typo-count buckets (0-typo, 1-typo, ...) BEFORE `sort` ever runs, and
 * `sort` then only reorders WITHIN each bucket. A page spanning a bucket
 * boundary is legitimately non-monotonic as a WHOLE — that restart is the
 * new rule working as intended (google-serp semantics: exact matches first,
 * each tier sorted within itself), not the searchCutoffMs partial-sort
 * disorder this guard exists to catch.
 *
 * Retrieval is title-scoped (title/company/tags) for role queries under every
 * sort, whole-document only for the tech-skill path and the empty-pool fallback.
 * The titled hits (matched via the SAME `titleMatchesQuery` predicate the
 * client-side seam partition (`partitionByTitleMatch`, presentation.ts) uses)
 * are still the 0-typo bucket's visible face. Checking sortedness on that
 * subsequence alone restores a promise the guard can actually verify. Below
 * the seam carries
 * no such promise ("weaker matches" — see `seamSummarySorted`,
 * presentation.ts); it was never this guard's job to order that tail.
 *
 * Unscoped (empty `q`, or relevance mode) returns `hits` unchanged — the
 * guard's original whole-page check.
 */
export function sortVerifiableHits(hits: PublicJob[], mode: JobSortMode, q: string | undefined): PublicJob[] {
    if (!shouldScopeTextMatchToTitle(mode, q)) return hits;
    return hits.filter((hit) => titleMatchesQuery(decodeText(hit.title), q ?? ""));
}
