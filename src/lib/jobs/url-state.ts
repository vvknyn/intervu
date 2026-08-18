import type { BoardId } from "@/lib/boards/types";
import { isBoardId } from "@/lib/boards/allowlists";
import type { FacetKey, JobSearchParams, JobSortMode, PostedBucket } from "./types";

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
    board: BoardId | null;
    /**
     * Restrict the corpus to ONE employer, addressed by `company_domain` —
     * the identity the index actually keys on (`JobSearchParams.companyDomain`,
     * types.ts → `company_domain = "..."`, meilisearch.ts).
     *
     * Exists because `/co/[slug]`'s "View all N jobs" CTA had no way to say
     * "this employer" and fell back to `q: <display name>`, a free-text
     * search. Measured live 2026-08-16: `/co/harrods--com` counts 108 roles
     * by domain, its CTA's `q=Harrods` returned 109 rows of which ZERO in the
     * top 20 were Harrods — "Harrods" is a VENUE, so it saturates the titles
     * and locations of other employers' concession roles inside the store
     * (Chanel, Burberry, Saint Laurent, Hermès).
     *
     * A name is a lossy encoding of an employer in both directions: it
     * over-matches (the venue case above) and under-matches (the index stores
     * "Harrods Limited"; the page displays the suffix-stripped "Harrods", and
     * `isCompanyNameQuery`'s company-scoping rescue — company-intent.ts —
     * requires exact equality after normalization, so it never fired). A
     * domain has neither failure mode: the CTA's result set is now the SAME
     * set the page counted, by construction rather than by heuristic.
     *
     * Kept as its own field rather than folded into `board`: `board` is an
     * allowlist-validated `BoardId` (`isBoardId`) naming a CURATED domain
     * set, so expressing one employer through it would mean enumerating
     * employers in an allowlist — the coupling this field exists to avoid.
     */
    companyDomain: string | null;
}

/**
 * Strip `sort` back to unset. The shared URL-state transition for "ranked by
 * résumé" no longer being claimed — used by the "Ranked by your résumé ✕"
 * chip's own dismiss (`clearFit`, src/app/jobs/page.tsx). Explore taking
 * over used to go through this too (review fix, 2026-07-18), but Explore is
 * now ephemeral, non-URL state (design decision, 2026-07-21) — it resets the
 * URL to browse-default directly (`buildUrlState({ q: "", facets: {}, sort:
 * null })`) rather than clearing sort alone, so it no longer needs this
 * function.
 */
export function withSortCleared(state: JobsUrlState): JobsUrlState {
    return { ...state, sort: null };
}

/**
 * Should an explicit sort override reset given the CURRENT query (approved
 * product change, 2026-08-13)? An explicitly chosen sort is now STICKY
 * across query text edits — typing a new search no longer silently
 * discards "top pay" or "freshest" back to Best match, so this no longer
 * needs the previous query at all (dropped from the signature along with
 * the caller's now-pointless prev-query tracking). The one remaining reset
 * is a genuine invalid-combination case: the query is EMPTY while the
 * override is specifically "relevance", which is meaningless without a
 * query (`resolveEffectiveSort` already falls back to "newest" for this
 * case server-side). Any OTHER override (e.g. salary_desc) still makes
 * sense with no query and is left alone.
 *
 * Depends only on the query, so a facet/salary/visa/ghost change never
 * resets an explicit sort either, matching the product requirement that
 * filter tweaks preserve the user's sort choice.
 */
export function shouldResetSortOnQueryChange(nextQuery: string, sortOverride: JobSortMode | null): boolean {
    if (sortOverride === null) return false;
    return !nextQuery.trim() && sortOverride === "relevance";
}

/**
 * Fresh-visit default (product decision): `postedBucket` is "30d" rather
 * than unset. `undefined` still means "no filter" (an explicit "Any" — see
 * `parseJobsUrl`/`serializeJobsUrl` below), it's just no longer the DEFAULT
 * a bare `/jobs` visit lands on.
 */
export const DEFAULT_URL_STATE: JobsUrlState = {
    q: "",
    facets: {},
    salaryMin: 0,
    visaOnly: false,
    postedBucket: "30d",
    hideGhosts: true,
    sort: null,
    jobId: null,
    board: null,
    companyDomain: null,
};

/**
 * A `company` param's canonical form. Lower/trimmed to match how the filter
 * itself compares (`company_domain = <trim().toLowerCase()>`, meilisearch.ts)
 * so `?company=Harrods.COM` and `?company=harrods.com` are ONE scope rather
 * than two URLs that search the same thing but compare unequal in
 * `searchKey`. Empty → `null` (no scope), never an empty-string filter that
 * would match nothing.
 */
function normalizeCompanyDomain(raw: string | null): string | null {
    return raw?.trim().toLowerCase() || null;
}

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

/**
 * A saved search's own filters as `JobSearchParams`, deliberately WITHOUT
 * `postedBucket` — a "posted within Nd of now" window would silently
 * undercount/underlist once `sinceMs` is older than that window, since the
 * question here is "since sinceMs," not "since some fixed relative bucket."
 * `sinceMs`, when given, becomes the `posted_ts` cursor filter instead.
 *
 * Single source of truth for "a saved search's JobsUrlState as search
 * params": `countNewSinceAction` (actions/jobs.ts, the saved-search count
 * banner) and the digest's per-saved-search fetch (lib/email/digest/
 * collect.ts) both call this rather than each re-deriving the same
 * field-by-field mapping.
 */
export function jobSearchParamsFromUrlState(
    state: JobsUrlState,
    sinceMs?: number,
): Pick<
    JobSearchParams,
    "q" | "facets" | "salaryMin" | "visaOnly" | "hideGhosts" | "board" | "companyDomain" | "postedSinceMs"
> {
    return {
        q: state.q || undefined,
        facets: state.facets,
        salaryMin: state.salaryMin || undefined,
        visaOnly: state.visaOnly || undefined,
        hideGhosts: state.hideGhosts,
        board: state.board ?? undefined,
        // A company-scoped saved search must stay company-scoped: dropping it
        // here would widen the count banner and the digest back to the
        // free-text corpus the scope exists to exclude.
        companyDomain: state.companyDomain ?? undefined,
        ...(sinceMs !== undefined ? { postedSinceMs: sinceMs } : {}),
    };
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
    // Absent `posted` param → leave `s.postedBucket` at whatever it was
    // seeded from (`DEFAULT_URL_STATE.postedBucket`, "30d"): the default IS
    // the no-param case now. An explicit "Any" needs its own encoding since
    // it can no longer piggyback on absence — `posted=any` is a real,
    // distinguishable choice that maps to internal `undefined` ("no
    // filter" — the pre-existing meaning of undefined everywhere else this
    // field is read, e.g. `buildJobSearchPayload`). Any other recognized
    // bucket parses exactly as before (back-compat for existing `posted=7d`
    // links etc.); an unrecognized value is dropped, same as always.
    const posted = sp.get("posted");
    if (posted === "any") {
        s.postedBucket = undefined;
    } else if (posted && (POSTED_VALUES as readonly string[]).includes(posted)) {
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
    const board = sp.get("board");
    if (board && isBoardId(board)) s.board = board;
    s.companyDomain = normalizeCompanyDomain(sp.get("company"));
    return s;
}

export function serializeJobsUrl(s: JobsUrlState): string {
    const sp = new URLSearchParams();
    if (s.q) sp.set("q", s.q);
    for (const [key, param] of Object.entries(PARAM_FOR_FACET) as [FacetKey, string][]) {
        const values = s.facets[key];
        if (values?.length) sp.set(param, values.join(","));
    }
    // Mirrors `parseJobsUrl`'s encoding: `undefined` (explicit "Any") must
    // round-trip as a real param now that it's no longer the default —
    // omitting it would silently read back as "30d" on reload. The default
    // itself ("30d") stays omitted, same as any other default field here.
    if (s.postedBucket === undefined) sp.set("posted", "any");
    else if (s.postedBucket !== DEFAULT_URL_STATE.postedBucket) sp.set("posted", s.postedBucket);
    if (s.salaryMin > 0 && TIER_FOR_SALARY[s.salaryMin]) sp.set("salary", TIER_FOR_SALARY[s.salaryMin]);
    if (s.visaOnly) sp.set("visa", "1");
    if (!s.hideGhosts) sp.set("ghosts", "show");
    if (s.sort) sp.set("sort", s.sort);
    if (s.jobId) sp.set("job", s.jobId);
    if (s.board) sp.set("board", s.board);
    if (s.companyDomain) sp.set("company", s.companyDomain);
    const out = sp.toString();
    return out ? `?${out}` : "";
}
