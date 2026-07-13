/**
 * Pure sort resolution shared by Meilisearch and snapshot-preview backends.
 * Keeps auto-default, relevance-without-query normalization, and salary_desc
 * semantics in one place so unit tests can lock behavior without HTTP mocks.
 */
import { derivePostedTs } from "./meilisearch";
import type { JobSearchParams, JobSortMode, PublicJob } from "./types";

/** Resolve the effective sort, normalizing invalid combinations (e.g. relevance without query). */
export function resolveEffectiveSort(p: Pick<JobSearchParams, "q" | "sort">): JobSortMode {
    if (p.sort === "relevance" && !(p.q ?? "").trim()) return "newest";
    if (p.sort) return p.sort;
    return (p.q ?? "").trim() ? "relevance" : "newest";
}

/** Meilisearch sort array for a search request. `legacy` uses posted_at instead of posted_ts. */
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
