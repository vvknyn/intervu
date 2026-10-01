/**
 * Sort-mode resolution with no imports beyond types, shared by sort.ts (which
 * re-exports both) and the early first search /jobs's route gate builds
 * (early-first-search.ts), which must not pull the Meilisearch helpers into
 * the page's first load.
 */
import type { JobSearchParams, JobSortMode } from "./types";

/** Resolve the effective sort, normalizing invalid combinations (e.g. relevance without query). */
export function resolveEffectiveSort(p: Pick<JobSearchParams, "q" | "sort">): JobSortMode {
    if (p.sort === "relevance" && !(p.q ?? "").trim()) return "newest";
    if (p.sort) return p.sort;
    return (p.q ?? "").trim() ? "relevance" : "newest";
}

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
