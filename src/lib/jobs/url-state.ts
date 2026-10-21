import type { BoardId } from "@/lib/boards/types";
import { isBoardId } from "@/lib/boards/allowlists";
import type { FacetKey, JobSearchParams, JobSortMode, PostedBucket, YearsExperienceBucket } from "./types";

/** Sort values as they appear in the URL. `fit` = résumé rank (resolved page-side). */
export type UrlSort = "newest" | "relevance" | "salary" | "fit";

/** Full client state that round-trips through the /jobs URL. Defaults are omitted on serialize. */
export interface JobsUrlState {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    salaryMin: number;
    visaOnly: boolean;
    postedBucket: PostedBucket | undefined;
    /** True when `posted` is present in the URL or the user pinned Posted. */
    postedExplicit?: boolean;
    /** Minimum-years-of-experience bucket (`?years=`). `undefined` is both
     *  "no filter" and the pristine default — see `YearsExperienceBucket`'s
     *  doc (types.ts) for why this has no non-empty default unlike `postedBucket`. */
    yearsExperience: YearsExperienceBucket | undefined;
    hideGhosts: boolean;
    /** SERP "Hide already viewed" toggle (job_views history feature).
     *  Client-only post-filter — deliberately absent from
     *  `jobSearchParamsFromUrlState` below: view status isn't known to the
     *  search index, so this never reaches the server payload. */
    hideViewed: boolean;
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
 * Fresh-visit default (product decision): `postedBucket` is "90d" rather
 * than unset. `undefined` still means "no filter" (an explicit "Any" — see
 * `parseJobsUrl`/`serializeJobsUrl` below), it's just no longer the DEFAULT
 * a bare `/jobs` visit lands on.
 *
 * 90 days, not 30 (2026-09-30): a count on prod found 99.9% of
 * 2.76M live scraped roles in the index, but a typed search under the
 * default filters reached only ~790k of them; the 30-day window alone
 * dropped ~1.15M posted earlier. 90 days brings back ~730k open roles and
 * lines up with the 90+ day ghost rule, which already flags older ones.
 * `?posted=30d` still narrows to 30 days (and now serializes explicitly,
 * since it is no longer the default).
 */
export const DEFAULT_URL_STATE: JobsUrlState = {
    q: "",
    facets: {},
    salaryMin: 0,
    visaOnly: false,
    postedBucket: "90d",
    yearsExperience: undefined,
    hideGhosts: true,
    hideViewed: false,
    sort: null,
    jobId: null,
    board: null,
    companyDomain: null,
};

/**
 * The window For you packs, their pill counts and the résumé-ranked list use:
 * 30 days, narrower than the board's 90-day default. A pack is a
 * recommendation, where a fresh role matters more than reach. On the pack
 * audit against the golden résumés (2026-09-30), the 90-day window put a
 * 31-90 day old exact-title twin into the top 3 of 13 of 24 tiles, in place
 * of a role posted days ago. A pack's "Edit filters" link carries
 * `posted=30d`, so the board it opens lists the same roles. The "fresh" tile
 * narrows further, to 7 days (hub-tiles.ts).
 */
export const PACK_POSTED_BUCKET: PostedBucket = "30d";

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
    // Field-scoped location picks (typeahead, `SuggestField`) — separate
    // params from `country` so a picked city/state literal round-trips
    // through the SAME field it was advertised on, never through the
    // gazetteer re-resolution `country=` values go through. `country=`
    // itself is untouched: existing links keep resolving exactly as before.
    city: "location_city",
    state: "location_state",
    src: "source",
    tech: "tech_stack",
    skills: "must_have_skills",
};
const PARAM_FOR_FACET = Object.fromEntries(
    Object.entries(FACET_PARAMS).map(([p, k]) => [k, p]),
) as Record<FacetKey, string>;

/**
 * `salary` carries any floor a person can pick: every preset ($30k+, $75k+,
 * …) and any custom minimum. It used to accept only 50k/100k/150k/200k, so
 * the other presets and custom values silently fell off on reload or share.
 * Whole thousands read as `75k`; anything else is the plain number
 * (`65500`). A floor under $1,000 is junk (including the "Pay listed"
 * pack's internal `1`), and so is one over $1,000,000.
 */
const SALARY_URL_MIN = 1_000;
const SALARY_URL_MAX = 1_000_000;

function parseSalaryParam(raw: string | null): number | null {
    const m = raw?.trim().toLowerCase().match(/^(\d+)(k?)$/);
    if (!m) return null;
    const n = Number(m[1]) * (m[2] ? 1_000 : 1);
    return n >= SALARY_URL_MIN && n <= SALARY_URL_MAX ? n : null;
}

function salaryParam(n: number): string | null {
    if (!Number.isInteger(n) || n < SALARY_URL_MIN || n > SALARY_URL_MAX) return null;
    return n % 1_000 === 0 ? `${n / 1_000}k` : String(n);
}

const POSTED_VALUES: readonly PostedBucket[] = ["1d", "3d", "7d", "30d", "90d", "older"];
const YEARS_EXPERIENCE_VALUES: readonly YearsExperienceBucket[] = ["0-2", "3-5", "6-10", "11+"];
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
 *
 * `yearsExperience` IS included here, unlike `postedBucket` above — it is not
 * relative-to-now (a "6-10 years" bucket means the same thing regardless of
 * when the count/digest runs), so there is no equivalent staleness risk to
 * exclude it for.
 */
export function jobSearchParamsFromUrlState(
    state: JobsUrlState,
    sinceMs?: number,
): Pick<
    JobSearchParams,
    | "q" | "facets" | "salaryMin" | "visaOnly" | "hideGhosts" | "board" | "companyDomain" | "postedSinceMs"
    | "yearsExperience"
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
        yearsExperience: state.yearsExperience,
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
    // seeded from (`DEFAULT_URL_STATE.postedBucket`, "90d"): the default IS
    // the no-param case now. An explicit "Any" needs its own encoding since
    // it can no longer piggyback on absence — `posted=any` is a real,
    // distinguishable choice that maps to internal `undefined` ("no
    // filter" — the pre-existing meaning of undefined everywhere else this
    // field is read, e.g. `buildJobSearchPayload`). Any other recognized
    // bucket parses exactly as before (back-compat for existing `posted=7d`
    // and `posted=30d` links etc.); an unrecognized value is dropped, same
    // as always.
    const posted = sp.get("posted");
    if (posted === "any") {
        s.postedBucket = undefined;
        s.postedExplicit = true;
    } else if (posted && (POSTED_VALUES as readonly string[]).includes(posted)) {
        s.postedBucket = posted as PostedBucket;
        s.postedExplicit = true;
    }
    const years = sp.get("years");
    if (years && (YEARS_EXPERIENCE_VALUES as readonly string[]).includes(years)) {
        s.yearsExperience = years as YearsExperienceBucket;
    }
    const salary = parseSalaryParam(sp.get("salary"));
    if (salary !== null) s.salaryMin = salary;
    if (sp.get("visa") === "1") s.visaOnly = true;
    if (sp.get("ghosts") === "show") s.hideGhosts = false;
    if (sp.get("viewed") === "hide") s.hideViewed = true;
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
    // omitting it would silently read back as "90d" on reload. The default
    // itself ("90d") stays omitted, same as any other default field here;
    // any other bucket — "30d" included, now that it isn't the default — is
    // written out.
    if (s.postedBucket === undefined) sp.set("posted", "any");
    else if (s.postedBucket === DEFAULT_URL_STATE.postedBucket && s.postedExplicit) sp.set("posted", s.postedBucket);
    else if (s.postedBucket !== DEFAULT_URL_STATE.postedBucket) sp.set("posted", s.postedBucket);
    if (s.yearsExperience) sp.set("years", s.yearsExperience);
    const salary = salaryParam(s.salaryMin);
    if (salary) sp.set("salary", salary);
    if (s.visaOnly) sp.set("visa", "1");
    if (!s.hideGhosts) sp.set("ghosts", "show");
    if (s.hideViewed) sp.set("viewed", "hide");
    if (s.sort) sp.set("sort", s.sort);
    if (s.jobId) sp.set("job", s.jobId);
    if (s.board) sp.set("board", s.board);
    if (s.companyDomain) sp.set("company", s.companyDomain);
    const out = sp.toString();
    return out ? `?${out}` : "";
}

/** `/jobs` on exactly this state. An old `?view=` link still opens the list: the param is read by nothing now. */
export function jobsBoardHref(state: JobsUrlState): string {
    return `/jobs${serializeJobsUrl(state)}`;
}
