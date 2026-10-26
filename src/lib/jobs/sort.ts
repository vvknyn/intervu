/**
 * Pure sort resolution shared by Meilisearch and snapshot-preview backends.
 * Keeps auto-default, relevance-without-query normalization, and salary_desc
 * semantics in one place so unit tests can lock behavior without HTTP mocks.
 */
import { derivePostedTs } from "./meilisearch";
import type { JobSearchParams, JobSortMode, PublicJob } from "./types";
import { resolveEffectiveSort } from "./sort-mode";

// Pure and import-free, so /jobs's route gate can build the first search
// without pulling this module's Meilisearch helpers into the page's first load.
export { coerceSortToSupported, resolveEffectiveSort } from "./sort-mode";

/** Meilisearch sort array for a search request. `legacy` uses posted_at instead of posted_ts. */
/**
 * The one label source for a `JobSortMode`, shared by every surface that
 * names a sort option (desktop's "Sort: {label}" trigger + its
 * DropdownMenuItems, the mobile filter sheet's sort tabs) so a
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

/** The sort trigger's label: "Best fit" only when the list is actually ranked by the résumé fit, else the option's own label. */
export function sortTriggerLabel(mode: JobSortMode, resumeOnFile: boolean | null, fitActive: boolean): string {
    return fitActive ? "Best fit" : sortOptionLabel(mode, resumeOnFile);
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
 * Under an explicit non-relevance sort with a query, the non-tiered display seam (`partitionByTitleMatch`) must
 * move title matches above the rest, because a global sort interleaves them. A bare browse (`q` empty) has no query
 * text to partition on. Classified by `mode`, not by enumerating sort names.
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

type HitWithTypoScore = PublicJob & { _rankingScoreDetails?: { typo?: { score?: number } } };

/**
 * Check that a page of hits is in the order `mode` implies, over EVERY hit: the hits of each group (`tier`, the
 * side of the divider) must be in order among themselves, so a hit of the other group sitting between them cannot
 * hide a break. This is the sort-integrity guard's read on whether Meilisearch finished applying the requested
 * `sort` — `searchCutoffMs` can interrupt a slow search and return partial results with the sort only PARTIALLY
 * applied (8 order-restarts in one 40-hit "newest" page, 2026-08-14).
 *
 * `typo` sits ahead of `sort` in `rankingRules` (JOBS_INDEX_SETTINGS), so for a typed query the engine legitimately
 * restarts the order where a hit's typo score gets WORSE. That is the only excused break: a typo score that gets
 * better further down the list is disorder. A typed query's pair where either hit has no score details (a path that
 * did not ask for them) cannot be told from a typo restart, so it is not judged: no retry. A browse has no typo rule
 * in play (`typed` false), so its pairs are compared directly. Ties are allowed (`compareJobsBySort` returning 0):
 * bulk-ingested documents share one posted_ts millisecond.
 */
export function isSortedWithinGroups(hits: PublicJob[], mode: JobSortMode, typed: boolean): boolean {
    const lastOfGroup = new Map<number, HitWithTypoScore>();
    for (const hit of hits as HitWithTypoScore[]) {
        const group = hit.tier ?? 0;
        const previous = lastOfGroup.get(group);
        lastOfGroup.set(group, hit);
        if (!previous) continue;
        if (typed) {
            const [a, b] = [previous._rankingScoreDetails?.typo?.score, hit._rankingScoreDetails?.typo?.score];
            if (a === undefined || b === undefined) continue;
            if (b < a) continue;
            if (b > a) return false;
        }
        if (compareJobsBySort(previous, hit, mode) > 0) return false;
    }
    return true;
}
