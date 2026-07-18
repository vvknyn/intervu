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
