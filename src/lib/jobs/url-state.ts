import type { FacetKey, JobSortMode, PostedBucket } from "./types";

/** Sort values as they appear in the URL. `fit` = résumé rank (resolved page-side). */
export type UrlSort = "newest" | "relevance" | "salary" | "fit";

/** Full client state that round-trips through the /jobs URL. Defaults are omitted on serialize. */
export interface JobsUrlState {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    salaryMin: number;
    visaOnly: boolean;
    postedBucket: PostedBucket | undefined;
    hideGhosts: boolean;
    sort: UrlSort | null;
    jobId: string | null;
}

/**
 * Strip `sort` back to unset. The shared URL-state transition for every
 * place "ranked by résumé" must stop being claimed — the chip's own dismiss
 * AND, symmetrically, Explore taking over the query (see `activateExplore`
 * in `src/app/jobs/page.tsx`). Both call through this one function so the
 * two directions can't drift apart (review fix, 2026-07-18: Explore used to
 * leave `sort=fit` — and the chip + Select label with it — stuck in the URL
 * after activating).
 */
export function withSortCleared(state: JobsUrlState): JobsUrlState {
    return { ...state, sort: null };
}

/**
 * The URL-state Explore activation writes when it takes over the query (see
 * `activateExplore` in `src/app/jobs/page.tsx`) — replaces `q` with the new
 * Explore query, clears `facets` (Explore's own query already encodes
 * intent, exactly like the fit pipeline's `q` did before it), and strips
 * `sort` so a stale "ranked by résumé" claim can't survive alongside it.
 *
 * Takes `prior` (a full snapshot, e.g. from `buildUrlState()`) and the new
 * `exploreQuery` as SEPARATE arguments and unconditionally overwrites
 * `q`/`facets`/`sort` in its own body — never reads `prior.q`/`prior.facets`
 * for the result — so it cannot reproduce the staleness bug this was
 * extracted to fix (review fix, 2026-07-18): a caller can pass ANY prior
 * snapshot, stale or not, for the fields it doesn't touch (salaryMin,
 * visaOnly, postedBucket, hideGhosts, jobId) and still get a correct result.
 */
export function composeExploreActivationUrlState(prior: JobsUrlState, exploreQuery: string): JobsUrlState {
    return { ...prior, q: exploreQuery, facets: {}, sort: null };
}

/**
 * Should an explicit sort override reset when the query transitions from
 * `prevQuery` to `nextQuery` (Phase 1-a #3)? Two independent triggers
 * collapse to the same action — clear back to auto (Best match once a query
 * exists):
 *   - the query becomes a DIFFERENT, non-empty value: a genuinely new search
 *     should always start on Best match rather than silently inheriting
 *     whatever sort was active for a different (or absent) prior query —
 *     the class-fix for the observed first-search wrong-order bug.
 *   - the query becomes EMPTY while the override is specifically
 *     "relevance": relevance is meaningless without a query
 *     (`resolveEffectiveSort` already falls back to "newest" for this case
 *     server-side); any OTHER override (e.g. salary_desc) still makes sense
 *     with no query and is left alone.
 *
 * Depends only on the query, so a facet/salary/visa/ghost change — query
 * unchanged — never resets an explicit sort, matching the product
 * requirement that filter tweaks preserve the user's sort choice.
 */
export function shouldResetSortOnQueryChange(
    prevQuery: string,
    nextQuery: string,
    sortOverride: JobSortMode | null,
): boolean {
    if (sortOverride === null) return false;
    const nextTrimmed = nextQuery.trim();
    if (!nextTrimmed) return sortOverride === "relevance";
    return nextTrimmed !== prevQuery.trim();
}

export const DEFAULT_URL_STATE: JobsUrlState = {
    q: "",
    facets: {},
    salaryMin: 0,
    visaOnly: false,
    postedBucket: undefined,
    hideGhosts: true,
    sort: null,
    jobId: null,
};

const FACET_PARAMS: Record<string, FacetKey> = {
    work: "work_type",
    exp: "experience_level",
    emp: "employment_type",
    country: "location_country",
    src: "source",
};
const PARAM_FOR_FACET = Object.fromEntries(
    Object.entries(FACET_PARAMS).map(([p, k]) => [k, p]),
) as Record<FacetKey, string>;

const SALARY_TIERS: Record<string, number> = {
    "50k": 50_000, "100k": 100_000, "150k": 150_000, "200k": 200_000,
};
const TIER_FOR_SALARY = Object.fromEntries(
    Object.entries(SALARY_TIERS).map(([label, n]) => [n, label]),
) as Record<number, string>;

const POSTED_VALUES: readonly PostedBucket[] = ["1d", "3d", "7d", "30d", "older"];
const SORT_VALUES: readonly UrlSort[] = ["newest", "relevance", "salary", "fit"];

export function urlSortToMode(s: UrlSort): JobSortMode | "fit" {
    return s === "salary" ? "salary_desc" : s;
}

export function parseJobsUrl(sp: URLSearchParams): JobsUrlState {
    const s: JobsUrlState = { ...DEFAULT_URL_STATE, facets: {} };
    const q = sp.get("q");
    if (q) s.q = q;
    for (const [param, key] of Object.entries(FACET_PARAMS)) {
        const raw = sp.get(param);
        if (!raw) continue;
        const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
        if (values.length) s.facets[key] = values;
    }
    const posted = sp.get("posted");
    if (posted && (POSTED_VALUES as readonly string[]).includes(posted)) {
        s.postedBucket = posted as PostedBucket;
    }
    const salary = sp.get("salary");
    if (salary && salary in SALARY_TIERS) s.salaryMin = SALARY_TIERS[salary];
    if (sp.get("visa") === "1") s.visaOnly = true;
    if (sp.get("ghosts") === "show") s.hideGhosts = false;
    const sort = sp.get("sort");
    if (sort && (SORT_VALUES as readonly string[]).includes(sort)) s.sort = sort as UrlSort;
    const job = sp.get("job");
    if (job) s.jobId = job;
    return s;
}

export function serializeJobsUrl(s: JobsUrlState): string {
    const sp = new URLSearchParams();
    if (s.q) sp.set("q", s.q);
    for (const [key, param] of Object.entries(PARAM_FOR_FACET) as [FacetKey, string][]) {
        const values = s.facets[key];
        if (values?.length) sp.set(param, values.join(","));
    }
    if (s.postedBucket) sp.set("posted", s.postedBucket);
    if (s.salaryMin > 0 && TIER_FOR_SALARY[s.salaryMin]) sp.set("salary", TIER_FOR_SALARY[s.salaryMin]);
    if (s.visaOnly) sp.set("visa", "1");
    if (!s.hideGhosts) sp.set("ghosts", "show");
    if (s.sort) sp.set("sort", s.sort);
    if (s.jobId) sp.set("job", s.jobId);
    const out = sp.toString();
    return out ? `?${out}` : "";
}
