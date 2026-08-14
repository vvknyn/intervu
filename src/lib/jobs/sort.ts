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
 * Does an explicit-sort search need its text matching scoped to title+company
 * only, dropping description/location/tags from consideration? See
 * `JOBS_INDEX_SETTINGS`'s `rankingRules` docblock (meilisearch.ts) — `sort`
 * now sits right after `words`, acting as a true ORDER BY for any request
 * that carries one, so a query match buried in a posting's description can
 * surface a totally unrelated title under an explicit sort (q="product
 * manager" + FRESHEST returning "Driver - Class 5"). Scoping retrieval to
 * title+company is what keeps a hit meaning "this posting IS what was
 * searched for" once ranking can no longer bury a weak match behind
 * relevance.
 *
 * Classified by `mode`, not by enumerating sort names: any resolved sort
 * OTHER than `"relevance"` is, by definition, an explicit global ordering —
 * see `resolveEffectiveSort`. Relevance (explicit or auto-defaulted) is
 * untouched: with no `sort` param sent to Meilisearch the `sort` ranking
 * rule is inert, so whole-document search only ever gets REORDERED by
 * relevance, never risks surfacing under an ordering it didn't earn. A bare
 * browse (`q` empty) is also untouched — there is no query text to scope.
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
