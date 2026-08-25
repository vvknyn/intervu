/**
 * Pure sort resolution shared by Meilisearch and snapshot-preview backends.
 * Keeps auto-default, relevance-without-query normalization, and salary_desc
 * semantics in one place so unit tests can lock behavior without HTTP mocks.
 */
import { derivePostedTs } from "./meilisearch";
import { decodeText, titleMatchesQuery } from "./presentation";
import type { JobSearchParams, JobSortMode, PublicJob } from "./types";

/** Resolve the effective sort, normalizing invalid combinations (e.g. relevance without query). */
export function resolveEffectiveSort(p: Pick<JobSearchParams, "q" | "sort">): JobSortMode {
    if (p.sort === "relevance" && !(p.q ?? "").trim()) return "newest";
    if (p.sort) return p.sort;
    return (p.q ?? "").trim() ? "relevance" : "newest";
}

/** Meilisearch sort array for a search request. `legacy` uses posted_at instead of posted_ts. */
/**
 * "Newest" ranks on `posted_ts`. When no document carries that field the sort
 * is a silent no-op — Meilisearch falls back to its default order while the UI
 * goes on claiming "newest first", which is how a board ends up listing 1mo,
 * 2mo, 5mo, 1mo under that label.
 *
 * Callers pass whether the corpus can actually answer a date sort (see
 * `isPostedDateFilterSupported`); an unsupported "newest" degrades to relevance
 * rather than lying about the order. Sorting on `posted_at` is NOT the fallback:
 * it is sortable, but the corpus carries future-dated sentinels (2030-01-31),
 * so descending order would put fabricated postings on top.
 */
export function coerceSortToSupported(mode: JobSortMode, postedDateSupported: boolean): JobSortMode {
    return mode === "newest" && !postedDateSupported ? "relevance" : mode;
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
 * Matching itself is whole-document for every sort (`buildSearchBody`).
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
 * Retrieval is whole-document for every sort. The titled hits (matched via
 * the SAME `titleMatchesQuery` predicate the client-side seam partition
 * (`partitionByTitleMatch`, presentation.ts) uses) are still the 0-typo
 * bucket's visible face. Checking sortedness on that subsequence alone
 * restores a promise the guard can actually verify. Below the seam carries
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
