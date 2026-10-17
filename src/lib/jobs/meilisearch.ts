/**
 * Meilisearch backend for intervu jobs search (SERVER-ONLY, SDK-free).
 *
 * intervu owns its own search index; Subspace is the system of record. This
 * module talks to Meilisearch over its HTTP API via `fetch` (no SDK dependency
 * — keeps the engine swappable; "Meilisearch vs Typesense" is an open decision
 * in docs/intervu-jobs-api.md). Read-path search uses the search-only key;
 * ingestion/admin uses the admin key and is only ever invoked by the sync
 * worker on the pipeline box — never at request time.
 */
import { getBoardDomains } from "@/lib/boards/allowlists";
import {
  applyCompanyDomainPin,
  COMPANY_INTENT_SAMPLE,
  dominantCompanyDomains,
  isCompanyNameQuery,
  normalizeCompanyName,
  type CompanyNameSample,
} from "./company-intent";
import {
  assembleCompanyLanePool,
  buildCompanyScopedSearchLanes,
  companyLaneTailWindow,
  shouldRunCompanyScopedLanes,
  type CompanyLaneFetch,
} from "./company-scoped-lanes";
import { isTechSkillQuery } from "./tech-skills";
import { decodeText, displayCompanyBrand, humanizeTenantSubdomain, isDomainSquashName, titleMatchesQuery, titleRelevanceScore } from "./presentation";
import { parseQuotedOrPhrases, resolveFitPhrases, shouldRunFitPhraseLane } from "./fit-phrases";
import { sanitizeContentPhrases } from "./for-you/content-phrases";
import { roleTitlePairQueries, shouldRunRoleTitleLane, titleSatisfiesRoleQuery } from "./role-title-lane";
import { normalizePublicJobs } from "./normalize-public-job";
import { sanitizeTimestamp } from "./posting-freshness";
import { buildMeiliSort, compareJobsBySort, isPageSorted, resolveEffectiveSort, sortVerifiableHits } from "./sort";
import { FACETABLE_KEYS, REQUESTED_FACET_KEYS } from "./types";
import { listedPastSenior, titlePastSenior } from "./role-level";
import { facetFilterClause } from "./unknown-inclusive-facets";
import type { FacetDistribution, JobSearchParams, JobSearchResult, JobSuggestions, PlaceClause, PublicJob } from "./types";

export const JOBS_INDEX = "jobs";

/**
 * Declared source table for JOBS_SYNONYMS (spec §6.4). Conservative by
 * design: only unambiguous industry abbreviations.
 *
 * Meilisearch synonyms are DIRECTIONAL — declaring `swe -> ["software
 * engineer"]` does NOT make "software engineer" match "swe". Every entry
 * here is expanded to BOTH directions by `deriveSynonyms` below, so a term
 * only needs to be declared once. Set `oneWay: true` to suppress the
 * reverse hop for a deliberate fan-out: "pm" expands to both "product
 * manager" and "project manager", but the reverse must NOT be added —
 * doing so would let a *product* manager search also return *project*
 * manager jobs (and vice versa) via the shared `pm` hop.
 */
const JOBS_SYNONYM_SOURCE: Array<{ term: string; expansions: string[]; oneWay?: boolean }> = [
  { term: "swe", expansions: ["software engineer"] },
  { term: "sre", expansions: ["site reliability engineer"] },
  { term: "pm", expansions: ["product manager", "project manager"], oneWay: true },
  { term: "k8s", expansions: ["kubernetes"] },
  { term: "ml", expansions: ["machine learning"] },
  { term: "ux", expansions: ["user experience"] },
  { term: "qa", expansions: ["quality assurance"] },
  { term: "hr", expansions: ["human resources"] },
  { term: "devops", expansions: ["dev ops"] },
  { term: "sde", expansions: ["software engineer", "software developer"] },
  { term: "software developer", expansions: ["software engineer"] },
  { term: "full stack", expansions: ["software engineer"], oneWay: true },
];

/** Expands a `JOBS_SYNONYM_SOURCE`-shaped table into Meilisearch's directional synonym map. */
export function deriveSynonyms(
  source: Array<{ term: string; expansions: string[]; oneWay?: boolean }>,
): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  const add = (key: string, value: string) => {
    const list = table[key] ?? (table[key] = []);
    if (!list.includes(value)) list.push(value);
  };
  for (const { term, expansions, oneWay } of source) {
    for (const expansion of expansions) {
      add(term, expansion);
      if (!oneWay) add(expansion, term);
    }
  }
  return table;
}

/**
 * Applied to the live index by scripts/apply-synonyms.mjs (synonyms-only
 * PUT — no reindex cost); ⚠ the box-side sync worker holds its own settings
 * copy, so a box reprovision can wipe these — reconcile there when S1 ships
 * (spec §9).
 *
 * Reverse hops (ux/qa/hr/devops) are inert alone as of 2026-08-24 — live
 * probe: "user experience" (3,733 matches) and "quality assurance" (27,917)
 * returned zero titles lacking the literal phrase, since exact matches
 * outrank synonym expansions. #296 shipped `distinct: "title"` on the
 * suggest path on the theory that a distinct top-20 would give expansions a
 * shot — measured AFTER #296 landed, that prediction is false. With
 * `distinct: "title"` live, a 20-hit distinct window still contains ZERO
 * titles lacking the literal phrase for "user experience", "quality
 * assurance" and "human resources" (and only one punctuation variant,
 * "Dev/Ops Engineer", for "dev ops"). `exactness` ranks literal-phrase
 * matches first and there are far more than 20 DISTINCT literal-phrase
 * titles, so synonym expansions never reach the window. `distinct` raised
 * the starvation threshold rather than removing it; surfacing
 * abbreviation-only titles would require a ranking-rule change. The reverse
 * hops remain inert but harmless.
 */
export const JOBS_SYNONYMS: Record<string, string[]> = deriveSynonyms(JOBS_SYNONYM_SOURCE);

/** Index settings for the jobs index. Applied by the sync worker on (re)provision. */
export const JOBS_INDEX_SETTINGS = {
  searchableAttributes: ["title", "company", "description", "location", "tags", "must_have_skills", "tech_stack"],
  filterableAttributes: [
    "work_type",
    "employment_type",
    "experience_level",
    "location_city",
    "location_state",
    "location_country",
    "salary_min",
    "salary_max",
    "visa_sponsorship",
    "ghost_badge",
    "source",
    "vacancy_status",
    "company_domain",
    "posted_ts",
    // Task 11 — the dead-link existence check (`JobSearchParams.id`, below)
    // needs `id = "..."` to be a legal filter. Meilisearch's primary key is
    // NOT automatically filterable, so it has to be declared here.
    //
    // LIVE as of 2026-07-25: the jobs index carries this setting and
    // `id = "<doc>"` resolves (verified against the box with a real document
    // id — 1 hit). It was code-only for six days after being added, during
    // which the filter 400'd and the existence check degraded to "unknown"
    // rather than declaring live roles dead. That degradation path stays —
    // see `classifyExistenceCheck` in lib/jobs/result-state.ts — because the
    // setting lives on the index, not in this repo, and a future re-provision
    // can drop it again without a deploy.
    "id",
    // Makes `distinct: "title"` legal on the typeahead's search body
    // (`buildSuggestBody`) — Meili rejects a non-filterable distinct
    // attribute with a 400. Applied live as Meili task 484080, 2026-08-24.
    "title",
    // Owned by the subspace-side sync worker, not intervu — populated by its
    // own classifier and applied live as Meili task 467532, 2026-08-18.
    // intervu never filters on it. Listed here anyway so this canon stays a
    // faithful mirror of the live index: a settings PATCH replaces
    // filterableAttributes wholesale, so omitting a live-only entry here
    // would silently DROP it on the next apply. Do not remove without
    // confirming the box no longer needs it.
    "occupation",
    // Enriched qualification and telemetry attributes (Subspace upstream)
    "min_years_experience",
    "max_years_experience",
    "must_have_skills",
    "preferred_skills",
    "tech_stack",
    "in_office_days",
    "normalized_salary_min",
    "normalized_salary_max",
    "company_opened_90d",
    "company_closed_90d",
    "company_open_count",
  ],
  sortableAttributes: [
    "posted_at",
    "first_seen_at",
    "updated_at",
    "salary_min",
    "salary_max",
    "posted_ts",
    "min_years_experience",
    "normalized_salary_min",
    "company_opened_90d",
  ],
  // "posted_ts:desc" is the FINAL rule: recency is the tiebreak among
  // equally-relevant hits, never a substitute for relevance — the six rules
  // ahead of it (words..exactness) always decide first. Applied to the live
  // index by scripts/apply-ranking-rules.mjs (narrow PUT, no reindex cost).
  // Meili 1.45's canonical rule names (live GET returns attributeRank /
  // wordPosition — the legacy attribute/position names predate it).
  //
  // `sort` sits directly after `words`, ahead of every relevance rule
  // (typo/proximity/attributeRank/wordPosition/exactness) — an explicit user
  // sort must win globally, not just within a relevance bucket. (2026-08-13;
  // see the dated chapter at the end of this comment for why.)
  //
  // History, because this reverses an earlier decision rather than ignoring
  // it. S3 (search-audit.md class 3) moved `sort` to the end after q=stripe +
  // "freshest" jumped a Dash0 posting that merely MENTIONS Stripe above the
  // real Stripe listings. That was the right call AT THE TIME: `exactness` on
  // `company` was the only thing separating "IS the company" from "mentions
  // it", so letting a sort outrank it broke company queries.
  //
  // That defence is now structural instead of positional. A company-intent
  // query is scoped with attributesToSearchOn: ["company"] (company-intent.ts,
  // whose docblock states the scoping is precisely "what lets `exactness` be
  // demoted to fix role queries without trading one regression for another").
  // A posting that only mentions Stripe in its description can no longer match
  // at all, so ordering can no longer promote it.
  //
  // Measured against the live index 2026-08-12, AFTER this order went in:
  //   SCOPED   q=stripe + posted_ts:desc — top 8 all company="Stripe",
  //            freshest 4d. The S3 regression does not reproduce.
  //   UNSCOPED q=stripe + posted_ts:desc — 3 of the top 8 are NOT Stripe
  //            ("Line Striper-Pavement Marking Technician", "FOREMAN - SEAL
  //            & STRIPE"); typo/word matches on the title.
  // The unscoped number is the point, not a caveat: it is what this ordering
  // costs when scoping does NOT fire, and the reason the company-intent gate
  // is load-bearing rather than an optimisation. If that gate is ever
  // weakened or removed, S3 comes straight back — re-measure both shapes
  // before touching either file.
  //
  // What the old order cost, measured 2026-08-12: `sort` after `exactness`
  // means an explicit sort can only reorder WITHIN an exactness tier, so
  // "freshest" could not break the tie it exists to break. q="product manager"
  // + posted_ts:desc filtered to Canada returned 5d, 6d, 6d, 8d, 9d, 19d, 28d,
  // 32d — every one a bare "Product Manager" — while a 1-day-old "Product
  // Manager - Activation & Deployment" sat below all of them on exactness
  // 0.667. A 32-day-old posting above a 1-day-old one, under a control
  // labelled FRESHEST. The S3 docblock claimed this ordering avoided
  // "drowning a multi-word role query in stale exact-title matches"; it does
  // not, and that claim is what this measurement falsifies.
  //
  // BEST is deliberately unchanged: with no `sort` parameter the `sort` rule
  // is inert, so relevance still decides and `posted_ts:desc` stays the final
  // tiebreak. Only queries that explicitly ask to be sorted are affected.
  //
  // 2026-08-13: the #177 order above still wasn't a global sort. `sort` sat
  // after typo/proximity/attributeRank/wordPosition, so an explicit sort only
  // reordered WITHIN whichever bucket those four rules already produced —
  // the same shape of problem #177 fixed one level up, still present one
  // level down. Measured live 2026-08-13, UNDER the #177 order: q="product
  // manager" +Canada +30d sorted posted_ts:desc returned 2.48d as its newest
  // hit, while the index provably contained 14 matching docs posted <24h
  // (exact page-mode count, complement-sum verified 14+2308=2322); q=
  // "technical account manager" sorted returned 16d, 16d, 15.2d, 8.9d, 29d,
  // 10.3d — non-monotonic.
  //
  // Why after `words` is safe: the strict path always uses
  // matchingStrategy:"all", under which every hit matches every query word,
  // making `words` uniform across the result set — so `sort` acting right
  // after it is a global sort with no bucketing left to break. The relaxed
  // fallback (strategy:"last", fires only when the strict pass returns zero
  // total) still ranks fuller word-matches first, THEN freshest. BEST MATCH
  // sends no `sort` param, so the `sort` rule stays inert there and relevance
  // is unchanged.
  //
  // Stated cost: a fresh posting that matches the query only in its
  // description can now surface under an explicit sort — it was already in
  // the matched set, just hidden behind an earlier bucket. This is inherent
  // to a true ORDER BY, not a new leak, and is accepted per Vivek's
  // directive that FRESHEST shows newest by posted date.
  //
  // 2026-08-14: `typo` moved from after `sort` to directly after `words` —
  // ["words","typo","sort",...] instead of ["words","sort","typo",...].
  // Under the 2026-08-13 order, `sort` outranked `typo`, so an explicit sort
  // was a true global ORDER BY across BOTH exact and typo-tolerant matches
  // together — a fuzzy admit could freely interleave with real matches
  // wherever its date/salary put it. Measured live 2026-08-14 (q="product
  // manager", scoped to title+company, fresh sort): 18 of the first 200 hits
  // were typo/company-fuzzy admits, e.g. Loblaw "Produce Manager" ("produce"
  // is a 1-typo match on "product") and "Environmental, Health and Safety
  // Manager" @ Revere Copper Products (company name is a 1-typo match).
  // Under an explicit sort — google-serp semantics, Vivek's directive — a
  // near-miss should never outrank an exact one; it should rank BELOW every
  // exact match and only compete on date/salary within its own typo tier.
  //
  // Two alternatives were measured and rejected before this reorder:
  //   - rankingScoreThreshold: NOT viable. Typo admits scored 0.6241–0.7497
  //     while legitimate titled matches spanned 0.5616–1.0 — the two bands
  //     overlap, so no threshold separates "exact" from "fuzzy" without also
  //     cutting real matches.
  //   - per-query typoTolerance (disabling fuzziness for one search rather
  //     than reordering the whole index): NOT supported on Meili 1.45.2 —
  //     probed live, the search body 400s with "Unknown field".
  // Putting `typo` ahead of `sort` fixes it structurally instead: Meilisearch
  // applies rankingRules strictly lexicographically, so `typo` now fully
  // partitions the result set into typo-count buckets (0-typo, 1-typo, ...)
  // BEFORE `sort` ever runs, and `sort` then only reorders WITHIN each
  // bucket. A page can legitimately restart its date/salary order at a
  // bucket boundary — that restart is this rule working as intended, not the
  // searchCutoffMs partial-sort disorder the sort-integrity guard exists to
  // catch (see `applySortIntegrityGuard` below).
  //
  // BEST is byte-identical: BEST sends no `sort` param, so the `sort` rule is
  // inert regardless of where it sits, and moving it past `typo` does not
  // change the RELATIVE order of any other rule — words, typo, proximity,
  // attributeRank, wordPosition, exactness, posted_ts:desc, exactly as
  // before once the inert `sort` rule is excluded. Only an explicit
  // (non-relevance) sort is affected.
  rankingRules: ["words", "typo", "sort", "proximity", "attributeRank", "wordPosition", "exactness", "posted_ts:desc"],
  synonyms: JOBS_SYNONYMS,
  // Repo-parity only, added 2026-08-27 — code-only, never applied from here.
  // Live GET against the jobs index that night showed this exact 15-word
  // list already set (source unknown — not this repo's apply-* scripts, none
  // of which touch stopWords); this repo's JOBS_INDEX_SETTINGS was silently
  // missing it, so the next settings PATCH (which REPLACES stopWords
  // wholesale, same hazard as filterableAttributes above) would have wiped
  // it. Live on the index since ~2026-08-27.
  stopWords: ["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"],
  // Made explicit 2026-08-23; previously left unset (silently riding Meili's
  // factory default, which these numbers equal exactly — GET-verified live
  // against the box that day). Declaring it turns "the typo-tolerance floor"
  // into a repo-owned value instead of an assumption about server defaults,
  // and gives `oneTypoMinWordSize` (below `buildSearchBody`) one place to
  // read it from — see that function's docblock for why it reads THIS
  // object rather than doing a live settings GET.
  typoTolerance: { minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 } },
  // Default cap is 1000; raise so result counts are exact across the corpus.
  pagination: { maxTotalHits: 100000 },
  // Facet values must sort by COUNT, not the Meili default (alpha). With alpha,
  // punctuation/digit-leading junk ('"city":""', '00000') fills the 100-value
  // cap and buries the real, high-count countries (US, India, Canada…). Sorting
  // by count surfaces the real values first; raising the cap keeps the long tail
  // reachable via "Show all". See lib/jobs/types.ts FACETABLE_KEYS.
  faceting: {
    maxValuesPerFacet: 300,
    sortFacetValuesBy: { "*": "count" },
  },
  // Default is 1500ms. Under embed-batch/indexing load a search can miss that
  // window and return PARTIAL results with `sort` incompletely applied — the
  // engine hands back a page that only started being ordered (2026-08-14
  // incident: 8 order-restarts in one 40-hit "newest" page). Raising the
  // budget shrinks how often a search gets cut off mid-sort; it does not
  // eliminate the class, so the FE sort-integrity guard (searchMeili,
  // isPageSorted/compareJobsBySort in sort.ts) covers whatever still slips
  // through.
  searchCutoffMs: 5000,
};

export function host(): string | null {
  const h = process.env.MEILISEARCH_HOST;
  return h ? h.replace(/\/+$/, "") : null;
}

export function hasMeilisearch(): boolean {
  return Boolean(host());
}

export function searchKey(): string {
  return process.env.MEILISEARCH_SEARCH_KEY || process.env.MEILISEARCH_API_KEY || "";
}

/** Per-attempt timeout for a read-path Meilisearch call. Single knob — retune
 * here, nowhere else. */
export const MEILI_FETCH_TIMEOUT_MS = 8_000;
/** Delay before the one bounded retry. Short: this is recovering from a blip,
 * not backing off from sustained load. */
const MEILI_RETRY_BACKOFF_MS = 300;

/**
 * Pure retry-policy decision: given the HTTP status a Meilisearch call came
 * back with, is it worth the one bounded retry `meiliFetch` allows? Only
 * 5xx — the server told us something transient went wrong. A 4xx means the
 * REQUEST is wrong (bad filter syntax, auth, …); retrying ships the
 * identical wrong request again and just burns the timeout budget. Network-
 * level failures (thrown before any status exists — DNS, connection
 * refused, our own AbortController timeout) are a separate, always-retry
 * branch in `meiliFetch` and never reach this function.
 */
export function isRetryableMeiliFailure(status: number): boolean {
  return status >= 500;
}

async function meiliFetchOnce(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEILI_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A non-retryable (4xx) response IS the request being wrong — bad filter/
 * facet/sort syntax, an attribute missing from `filterableAttributes`, an
 * unfilterable id, etc (see `isRetryableMeiliFailure` above). That's a
 * deploy-time misconfiguration (index settings drifted from what this repo
 * expects), not a per-request fluke, and unlike a 5xx it never gets a retry
 * to paper over it — so it belongs in prod logs at error level, not just in
 * whatever message a caller happens to build from the body text. Logged here,
 * the one chokepoint every read-path call funnels through, rather than at
 * each of this file's several `throw`/fallback sites, so the log fires
 * identically regardless of which caller hit it or whether that caller goes
 * on to recover (e.g. the company_domain post-filter fallback) or throw.
 * `res.clone()` because the caller still needs to read the original body.
 */
async function logMeiliConfigError(url: string, res: Response): Promise<void> {
  const text = await res
    .clone()
    .text()
    .catch(() => "");
  let code: string | undefined;
  let message: string | undefined;
  try {
    ({ code, message } = JSON.parse(text) as { code?: string; message?: string });
  } catch {
    // Non-JSON body — code/message stay undefined, raw text still logged below.
  }
  console.error(
    `[meilisearch] request rejected: ${res.status} ${url} code=${code ?? "unknown"} message=${
      message ?? text.slice(0, 300)
    }`,
  );
}

/**
 * Chokepoint: every outbound Meilisearch READ-PATH call (search, suggestions,
 * freshness stamp, date-filter-support probe) funnels through here — never
 * call `fetch` directly for one of these, and never add a bespoke timeout/
 * retry at an individual call site (see writing-lean-code rule 3: class-wide
 * fix at the chokepoint, not per-instance). Adds a per-attempt
 * AbortController timeout plus ONE bounded retry on the failure classes a
 * retry can plausibly fix (network-level throw, or 5xx per
 * `isRetryableMeiliFailure`) — never on 4xx. Deliberately scoped to the read
 * path: the ingestion/admin functions below (pipeline-box sync worker, admin
 * key, bulk PUT/DELETE) run on their own schedule outside any web app
 * request and are out of scope for a client-request-time resilience fix.
 */
export async function meiliFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await meiliFetchOnce(url, init);
    if (res.ok) return res;
    if (!isRetryableMeiliFailure(res.status)) {
      await logMeiliConfigError(url, res);
      return res;
    }
    await new Promise((r) => setTimeout(r, MEILI_RETRY_BACKOFF_MS));
    return meiliFetchOnce(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, MEILI_RETRY_BACKOFF_MS));
    return meiliFetchOnce(url, init);
  }
}

/** Age-bucket → milliseconds lookback, used for both `posted_ts` filtering and derivation. */
const BUCKET_MS: Record<Exclude<NonNullable<JobSearchParams["postedBucket"]>, "older">, number> = {
  "1d": 1 * 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

/** Years-of-experience bucket → inclusive `[min, max]` on `min_years_experience`;
 *  `max: null` is the open-ended top bucket ("11+"). Mirrors `BUCKET_MS`'s role
 *  for `postedBucket` — the one lookup `buildFilter` translates through. */
const YEARS_EXPERIENCE_RANGES: Record<NonNullable<JobSearchParams["yearsExperience"]>, { min: number; max: number | null }> = {
  "0-2": { min: 0, max: 2 },
  "3-5": { min: 3, max: 5 },
  "6-10": { min: 6, max: 10 },
  "11+": { min: 11, max: null },
};

export interface BuildFilterOpts {
  skipDomainFilters?: boolean;
}

/**
 * `buildSearchBody`'s own options. Extends the filter options because the
 * same object is handed straight to `buildFilter`; `companyScoped` is a
 * RETRIEVAL concern (which attributes the query text may match), deliberately
 * kept as its own field rather than overloading a filter flag.
 */
export interface BuildSearchBodyOpts extends BuildFilterOpts {
  /** Query text names an employer — see company-intent.ts. */
  companyScoped?: boolean;
  /** Title-only recall lane for seniority+role pair searches. */
  titleScoped?: boolean;
  /** Expand pass: whole-document retrieval, still `matchingStrategy: "all"`. */
  wholeDocument?: boolean;
  /** Ask for `_rankingScoreDetails` on every hit — only the relevance-sorted
   *  typed search sets this, for `preferNewerAmongCloseMatches` below, which
   *  also strips the details before any hit leaves `searchMeili`. */
  rankingScoreDetails?: boolean;
}

/** TRANSITIONAL: live index may lack `company_domain` in filterableAttributes. */
let companyDomainFilterUnsupported = false;

export function resetCompanyDomainFilterSupportForTests(): void {
  companyDomainFilterUnsupported = false;
}

function needsDomainFilters(p: JobSearchParams): boolean {
  return Boolean(p.board || p.companyDomain || (p.companyDomains?.length ?? 0) > 0);
}

/** Domain label with TLD stripped — weak retrieval bias for company browse. */
export function domainRetrievalBias(companyDomain: string): string {
  const d = companyDomain.trim().toLowerCase();
  const dot = d.indexOf(".");
  return dot > 0 ? d.slice(0, dot) : d;
}

/** Query for the domain post-filter scan path. */
export function postFilterSearchQ(p: JobSearchParams): string {
  const q = p.q ?? "";
  if (!q.trim() && p.companyDomain && !p.board) {
    return domainRetrievalBias(p.companyDomain);
  }
  return q;
}

/** Board / companyDomain predicates — mirrors snapshot-preview passBase. */
export function jobMatchesDomainFilters(
  j: PublicJob,
  p: Pick<JobSearchParams, "board" | "companyDomain" | "companyDomains">,
): boolean {
  if (p.board) {
    const domains = getBoardDomains(p.board);
    if (domains.length > 0 && !domains.includes((j.company_domain ?? "").toLowerCase())) return false;
  }
  if (p.companyDomains?.length) {
    const allowed = new Set(p.companyDomains.map((d) => d.trim().toLowerCase()));
    if (!allowed.has((j.company_domain ?? "").toLowerCase())) return false;
  } else if (p.companyDomain) {
    if ((j.company_domain ?? "").toLowerCase() !== p.companyDomain.trim().toLowerCase()) return false;
  }
  return true;
}

export function filterHitsByDomainFilters(
  hits: PublicJob[],
  p: Pick<JobSearchParams, "board" | "companyDomain" | "companyDomains">,
): PublicJob[] {
  if (!needsDomainFilters(p)) return hits;
  return hits.filter((j) => jobMatchesDomainFilters(j, p));
}

/**
 * A remote job carrying no geographic restriction — ruling + data fact are
 * on `PlaceClause.remoteAnywhere` (jobs/types.ts), the one field that gates
 * whether `renderPlaceClause` below ORs this in. Exported so the sizing
 * probe (PR #479 body) and any future caller building the equivalent
 * top-level predicate quote the same literal, never a hand-copied second
 * one.
 *
 * "No place at all", not merely "no country" (2026-09-30): a remote role
 * whose location names a city or state but carries no country tag is a
 * role whose country is MISSING, not one open anywhere — prod listed
 * "Digital Data Analyst" at Afni, Burton-on-Trent (UK), in a Canada search
 * because the clause only asked for `location_country IS NULL`. City and
 * state must be empty too. Meilisearch keeps three different "empty"
 * shapes apart — `IS NULL` matches only a JSON null, `NOT EXISTS` only a
 * missing attribute, `IS EMPTY` only `""`/`[]` (verified on 1.45.2) — so
 * city and state accept all three. The country test stays exactly the
 * live-verified `IS NULL`: this change only narrows the set, never widens
 * it.
 */
export const REMOTE_ANYWHERE_CLAUSE =
  'work_type = "remote" AND location_country IS NULL' +
  " AND (location_city IS NULL OR location_city NOT EXISTS OR location_city IS EMPTY)" +
  " AND (location_state IS NULL OR location_state NOT EXISTS OR location_state IS EMPTY)";

/** Pure: one `PlaceClause` -> its Meilisearch boolean sub-expression — the
 *  `any` OR-group alone, or ANDed against `scopedToCountry` when present
 *  (see `PlaceClause`'s doc, jobs/types.ts, for why only a city/metro
 *  mention ever carries that second group). When `remoteAnywhere` is set
 *  (country resolutions only), `REMOTE_ANYWHERE_CLAUSE` is OR'd into the
 *  `any` group itself — never a separate AND'd part — so a place-bound work
 *  type ("onsite canada") or a global `work_type` facet still excludes it by
 *  construction: both render as a top-level AND against a clause that can
 *  only ever be satisfied by a `work_type = "remote"` doc. No explicit
 *  work-type guard needed here. */
export function renderPlaceClause(clause: PlaceClause): string {
  const anyExpr = clause.any.map((pl) => `${pl.field} = ${JSON.stringify(pl.value)}`).join(" OR ");
  const parts = [clause.remoteAnywhere ? `(${anyExpr} OR (${REMOTE_ANYWHERE_CLAUSE}))` : `(${anyExpr})`];
  if (clause.scopedToCountry?.length) {
    parts.push("(" + clause.scopedToCountry.map((pl) => `${pl.field} = ${JSON.stringify(pl.value)}`).join(" OR ") + ")");
  }
  // Work modes bound to THIS place (see `PlaceClause.workTypes`) AND into
  // the clause, so they constrain this place and no other.
  if (clause.workTypes?.length) {
    parts.push("(" + clause.workTypes.map((v) => `work_type = ${JSON.stringify(v)}`).join(" OR ") + ")");
  }
  // A lone group is returned bare — the parenthesised AND form is reserved
  // for the multi-part case, so a clause with no extras renders exactly the
  // string it always did.
  return parts.length === 1 ? parts[0]! : `(${parts.join(" AND ")})`;
}

/**
 * `legacy=true` drops anything that depends on `posted_ts` — the TRANSITIONAL
 * fallback used when the live index doesn't have the field yet (see
 * `searchMeili`'s 400-retry). Remove the `legacy` param once the reindex lands.
 */
/** The baseline "this vacancy is still live" invariant every real search
 *  applies (below). Exported because a SECOND reader now has to agree with it
 *  exactly — `lib/companies/indexable.ts` batch-counts live roles per domain
 *  to decide which `/co/[slug]` pages are worth submitting to Google, and a
 *  private second copy of this literal there could drift into counting roles
 *  the page itself never renders. Deliberately `!= "closed"`, not
 *  `= "active"`: those differ for any future third status. */
export const LIVE_VACANCY_FILTER = 'vacancy_status != "closed"';

/** Pure: AND `LIVE_VACANCY_FILTER` onto an optional caller filter clause —
 *  the same composition `buildFilter` does for real search (`f.push(...)`
 *  then every clause implicitly ANDed via `filter: string[]`), collapsed to
 *  a single string because `/facet-search` takes one `filter` string rather
 *  than an array. `extra` is expected pre-parenthesized when it's a
 *  multi-term expression (matches `renderPlaceClause`'s and
 *  `location-suggest.ts`'s convention), so it's safe to AND in unwrapped. */
export function withLiveVacancyFilter(extra?: string): string {
  return extra ? `${LIVE_VACANCY_FILTER} AND ${extra}` : LIVE_VACANCY_FILTER;
}

/** Widen sentinels — mean "no filter on this facet", not a corpus place name. */
export function isNeutralLocationFacetValue(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === "any" || t === "all";
}

export function canonicalFacetValues(rawVals: string[]): string[] {
  const vals = rawVals.filter((v) => !isNeutralLocationFacetValue(v));
  return [...new Set(vals)].sort();
}

export function buildFilter(p: JobSearchParams, legacy = false, opts?: BuildFilterOpts): string[] {
  const f: string[] = [LIVE_VACANCY_FILTER];
  // Task 11 — existence check: requires "id" in `filterableAttributes`
  // (JOBS_INDEX_SETTINGS above). Live on the index since 2026-07-25, so this
  // clause now resolves instead of 400ing.
  //
  // If a future re-provision drops the setting, the request fails and
  // `searchMeili` surfaces an "unavailable" result, which
  // `classifyExistenceCheck` (lib/jobs/result-state.ts) treats as "unknown" —
  // rendering nothing rather than asserting a live role is dead. Keep that
  // path: the setting is index state, not repo state. Every other clause
  // below is skipped for this request by construction (the caller passes only
  // `{ id, limit, offset }`) — see `JobSearchParams.id`.
  if (p.id) f.push(`id = ${JSON.stringify(p.id)}`);
  const facets = p.facets ?? {};
  for (const key of FACETABLE_KEYS) {
    const rawVals = facets[key];
    if (!rawVals || rawVals.length === 0) continue;
    const vals = canonicalFacetValues(rawVals);
    if (vals.length === 0) continue;
    // OR within a facet, AND across facets (unknown-inclusive facets add their unknown rows).
    f.push(facetFilterClause(key, vals));
  }
  if (p.places?.length) {
    // One OR group across every parsed place mention — see
    // `JobSearchParams.places` for why OR across mentions, and AND within
    // one (`renderPlaceClause`'s `scopedToCountry`).
    f.push("(" + p.places.map(renderPlaceClause).join(" OR ") + ")");
  }
  if (p.salaryMin && p.salaryMin > 0) {
    f.push(`(salary_max >= ${p.salaryMin} OR salary_min >= ${p.salaryMin})`);
  }
  if (p.visaOnly) f.push("visa_sponsorship = true");
  if (p.hideGhosts) f.push('ghost_badge != "likely_ghost"');
  if (p.postedBucket && !legacy) {
    const now = Date.now();
    if (p.postedBucket === "older") {
      // "Older" is everything the widest window (the 90d default) hides.
      f.push(`posted_ts < ${now - BUCKET_MS["90d"]}`);
    } else {
      f.push(`posted_ts >= ${now - BUCKET_MS[p.postedBucket]}`);
    }
    // Docs with a null posted_ts (not yet backfilled) simply won't match — acceptable.
  }
  if (p.yearsExperience) {
    // Unlike `postedBucket` above, a doc MISSING `min_years_experience`
    // must still match — see `JobSearchParams.yearsExperience`'s doc:
    // backfill coverage is ~47% and draining, so a bare range clause would
    // silently hide most of the corpus from every bucket rather than narrow
    // it. The union with `NOT EXISTS` is what keeps an unscored doc visible
    // until its own enrichment lands.
    const { min, max } = YEARS_EXPERIENCE_RANGES[p.yearsExperience];
    const bounds =
      max != null
        ? `(min_years_experience >= ${min} AND min_years_experience <= ${max})`
        : `min_years_experience >= ${min}`;
    f.push(`(${bounds} OR min_years_experience NOT EXISTS)`);
  }
  // `postedSinceMs` — an absolute floor rather than a relative bucket (see
  // its doc on `JobSearchParams`). Same `!legacy` gate as `postedBucket`
  // just above: both depend on `posted_ts` being filterable, so both drop
  // out together on the TRANSITIONAL pre-reindex retry.
  if (p.postedSinceMs != null && !legacy) {
    f.push(`posted_ts >= ${p.postedSinceMs}`);
  }
  if (!opts?.skipDomainFilters) {
    if (p.board) {
      const domains = getBoardDomains(p.board);
      if (domains.length > 0) {
        f.push(`company_domain IN [${domains.map((d) => JSON.stringify(d)).join(", ")}]`);
      }
    }
    if (p.companyDomains?.length) {
      const domains = [...new Set(p.companyDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
      if (domains.length > 0) {
        f.push(`company_domain IN [${domains.map((d) => JSON.stringify(d)).join(", ")}]`);
      }
    } else if (p.companyDomain) {
      f.push(`company_domain = ${JSON.stringify(p.companyDomain.trim().toLowerCase())}`);
    }
  }
  return f;
}

/** Pure relax policy: widen retrieval only on a true query miss — non-empty
 *  `q` AND zero strict/scoped hits. Filter-thin pages (e.g. 2 hits) must NOT
 *  expand. */
export function shouldRelaxSearch(strictTotal: number, q: string): boolean {
  return Boolean(q.trim()) && strictTotal === 0;
}

/** Union strict hits first, then expand-pass extras; `widened` only when extras
 *  were added. */
export function mergeExpandedIntoStrict(
  strict: JobSearchResult,
  expanded: JobSearchResult,
): JobSearchResult {
  const seen = new Set(strict.hits.map((h) => h.id));
  const extras = expanded.hits.filter((h) => !seen.has(h.id));
  if (extras.length === 0) return strict;
  return {
    ...strict,
    hits: [...strict.hits, ...extras],
    total: Math.max(strict.total, expanded.total),
    backend: strict.backend,
    configured: strict.configured,
    facetDistribution: strict.facetDistribution ?? expanded.facetDistribution,
    widened: true,
  };
}

/** Explicit shape so call sites and tests can touch optional fields under tsc. */
/**
 * "all" requires every query word to match; "last" is Meilisearch's default,
 * which drops words from the end until something matches. We search strictly
 * and relax deliberately — never the other way round.
 */
export type MatchingStrategy = "all" | "last";

/** List SERP retrieve set — every field row/cluster/filter/sort code actually
 *  reads, minus `description` (detail hydrates on demand). Search still uses
 *  default `searchableAttributes`; only the returned payload shrinks. Of the
 *  eight enriched qualification/telemetry attributes added to
 *  `filterableAttributes` above, only the three the SERP filter UI reads or
 *  renders (`min_years_experience`, `tech_stack`, `must_have_skills`) are
 *  listed here — `max_years_experience`, `preferred_skills`,
 *  `in_office_days`, `normalized_salary_min`/`max` have no reader yet and are
 *  filterable/sortable on the index without being fetched per row; add one
 *  here only once something in this repo reads it off `PublicJob`. */
export const JOB_LIST_ATTRIBUTES_TO_RETRIEVE = [
  "id",
  "title",
  "company",
  "company_domain",
  "location",
  "location_city",
  "location_state",
  "location_country",
  "work_type",
  "employment_type",
  "experience_level",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "visa_sponsorship",
  "tags",
  "apply_url",
  "source",
  "posted_at",
  "first_seen_at",
  "posted_ts",
  "updated_at",
  "vacancy_status",
  "ghost_badge",
  "ghost_checked_at",
  "last_observed_alive_at",
  "company_opened_90d",
  "company_closed_90d",
  "company_open_count",
  "company_stage",
  "is_indexed_google",
  "google_indexed_at",
  "is_indexed_linkedin",
  "linkedin_indexed_at",
  "report_count",
  "min_years_experience",
  "must_have_skills",
  "tech_stack",
] as const;

export interface MeiliSearchBody {
  q: string;
  matchingStrategy: MatchingStrategy;
  filter: string[];
  facets?: string[];
  limit: number;
  offset: number;
  sort?: string[];
  attributesToSearchOn?: string[];
  attributesToRetrieve?: readonly string[];
  showRankingScoreDetails?: boolean;
}

/**
 * `minWordSizeForTypos.oneTypo` — read from `JOBS_INDEX_SETTINGS.typoTolerance`
 * (declared above) rather than a live GET against
 * `/indexes/jobs/settings/typo-tolerance`. That endpoint needs the admin
 * key, which per this file's module docblock is available ONLY to the
 * pipeline-box sync worker (`sync.ts`) and is never present in a web app
 * request; the search-only key this read path actually holds 403s on every
 * settings endpoint (verified live 2026-08-23 — the same constraint
 * `fetchPostedDateFilterSupported` above already documents and works around
 * for `/stats`). A request-time GET here would 403 on every request in
 * production and permanently take the fail-safe branch below, so it would
 * ship as dead code that silently never fixes the bug it exists for.
 * Sourcing from the settings object the sync worker already applies to the
 * live index keeps one canonical number: retune typo tolerance by editing
 * `JOBS_INDEX_SETTINGS.typoTolerance` and both the live index (via the
 * pipeline repo's settings apply) and query-building below follow
 * automatically.
 *
 * Returns `null` — never a guessed number — if the field is ever missing or
 * malformed, so `quoteShortTokens` can fail safe to unquoted queries instead
 * of quoting against a fabricated threshold.
 */
function oneTypoMinWordSize(): number | null {
  const n = JOBS_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos.oneTypo;
  return typeof n === "number" && n > 0 ? n : null;
}

/**
 * Meilisearch treats the FINAL token of every query as a prefix match
 * (index-wide `prefixSearch: "indexingTime"` — no per-query opt-out on Meili
 * 1.45.2, verified live). For a short token that explodes: `q=produc`
 * returned 100,000 Product-role hits live; `q=tam` (Technical Account
 * Manager) returned 22,977 hits — Tampa, Tamayyaz, anything sharing the
 * prefix — while phrase-quoted `q="tam"` returned 1,822.
 *
 * Tokens below `oneTypoMinWordSize()` get NO typo tolerance from Meilisearch
 * either way, so wrapping them in phrase quotes (which also turns off prefix
 * matching for that token) forfeits nothing they had working. Tokens at or
 * above the threshold are left untouched — they keep both prefix and typo
 * behaviour exactly as before. Already-quoted segments (a user-typed phrase)
 * are left alone too: Meilisearch phrase search is already exact, so
 * re-quoting would only risk nesting quotes.
 *
 * This only ever runs on SUBMITTED search bodies (`buildSearchBody`) — the
 * typeahead path (`buildSuggestBody`) is a separate function this never
 * touches, so autocomplete keeps prefix matching for a word still being
 * typed.
 */
export function quoteShortTokens(q: string): string {
  const threshold = oneTypoMinWordSize();
  if (threshold === null) return q;
  const tokens = q.match(/"[^"]*"|\S+/g);
  if (!tokens) return q;
  return tokens.map((tok) => (tok.startsWith('"') || tok.length >= threshold ? tok : `"${tok}"`)).join(" ");
}

/**
 * Title-like fields for `titleFirstScoped` below (a bare role query — e.g.
 * "product manager", "registered nurse" — with no other lane claiming it).
 * The subset of the LIVE `JOBS_INDEX_SETTINGS.searchableAttributes` (verified
 * against the Meili box, 2026-09-09) that carries a role/occupation signal
 * rather than a skill or a free-text mention:
 *  - `description` excluded on purpose — that's the whole defect this scope
 *    exists to close (a description mention of "product information" is why
 *    "product manager" surfaced "Assistant Store Manager" on Freshest).
 *  - `location` excluded — not role-bearing.
 *  - `must_have_skills`/`tech_stack` excluded — skill fields, not occupation.
 *  - `occupation` itself excluded despite the name — it's
 *    `filterableAttributes`-only on the live index, NOT in
 *    `searchableAttributes`, so scoping to it would 400.
 * What's left: `title`, `company`, `tags`.
 */
const TITLE_FIRST_ATTRIBUTES_TO_SEARCH_ON = ["title", "company", "tags"] as const;

/**
 * A "bare role query" — free text with no other lane claiming it (not
 * company-named, not a tech-skill token, not a seniority+role pair the
 * role-title lane already owns). This is the exact predicate under which
 * `buildSearchBody` (below) scopes retrieval to `TITLE_FIRST_ATTRIBUTES_TO_SEARCH_ON`
 * — pulled out as its own export so `searchMeili`'s tiered-retrieval branch
 * can ask the SAME question ("does this query get the title-first scope?")
 * before it has a `MeiliSearchBody` to inspect, rather than re-deriving a
 * second copy of this condition that could drift from `buildSearchBody`'s.
 */
export function isBareRoleQuery(q: string, companyScoped: boolean): boolean {
  if (companyScoped) return false;
  if (isTechSkillQuery(q)) return false;
  if (parseQuotedOrPhrases(q) != null) return false;
  return Boolean(q.trim()) && !shouldRunRoleTitleLane(q, companyScoped);
}

/**
 * Sole source of truth for `attributesToSearchOn` given a resolved scope
 * classification (`companyScoped`/`titleScoped`, both already decided by the
 * caller — this function never derives them itself). `buildSearchBody` below
 * and `buildLastUpdatedQuery` (the freshness-stamp builder, further down this
 * file) both call THIS function with the SAME inputs, so the results query
 * and the "updated X ago" stamp query cannot independently decide this field
 * and drift apart — the exact defect a reviewer found in intervu #484 (the
 * stamp builder had no attribute-scope logic at all, so any non-empty text
 * query could match on `description` alone while the real results were
 * scoped to title/company).
 *
 * Priority, matching what `searchMeili` already does: an explicit
 * `companyScoped`/`titleScoped` override wins first (`company-scoped-lanes.ts`
 * and `role-title-lane.ts`'s own sub-queries pass these); otherwise a
 * standalone tech/programming-language token (e.g. "Rust", "Swift") scopes to
 * title/tags/description to avoid non-tech false positives ("Rust Medical
 * Center"); otherwise every other non-empty bare-role query scopes to
 * `TITLE_FIRST_ATTRIBUTES_TO_SEARCH_ON` so a description mention can't
 * surface an unrelated title; otherwise (empty query, or `wholeDocument`'s
 * expand pass) no restriction — whole-document.
 */
export function resolveAttributesToSearchOn(
  p: JobSearchParams,
  opts?: Pick<BuildSearchBodyOpts, "companyScoped" | "titleScoped" | "wholeDocument">,
): string[] | undefined {
  if (opts?.companyScoped) return ["company"];
  if (opts?.titleScoped) return ["title"];
  if (!opts?.wholeDocument && isTechSkillQuery(p.q ?? "")) return ["title", "tags", "description"];
  if (!opts?.wholeDocument && isBareRoleQuery(p.q ?? "", !!opts?.companyScoped)) {
    return [...TITLE_FIRST_ATTRIBUTES_TO_SEARCH_ON];
  }
  return undefined;
}

export function buildSearchBody(
  p: JobSearchParams,
  legacy: boolean,
  matchingStrategy: MatchingStrategy = "all",
  opts?: BuildSearchBodyOpts,
): MeiliSearchBody {
  const attributesToSearchOn = resolveAttributesToSearchOn(p, opts);
  return {
    // `quoteShortTokens` only rewrites the text handed to Meilisearch — every
    // classifier above (`resolveAttributesToSearchOn`, `buildFilter`, …)
    // still reads the raw `p.q`/`p` so quoting can never change what the
    // query is CLASSIFIED as, only how its short tokens are matched.
    q: quoteShortTokens(p.q ?? ""),
    ...(attributesToSearchOn ? { attributesToSearchOn } : {}),
    // Requiring every word is the honest default; `searchMeili` runs one
    // whole-document expand pass (`wholeDocument`) only after a strict/scoped
    // pass returns zero — never word-dropping (`matchingStrategy: "last"`).
    matchingStrategy,
    filter: buildFilter(p, legacy, opts),
    facets: p.withFacets ? [...REQUESTED_FACET_KEYS] : undefined,
    // `limit`/`offset`, not `hitsPerPage`/`page` — page mode forces exhaustive
    // count pagination over the full match set (see `buildSuggestBody`).
    // Exact totals at 100k+ are recovered via `resolveCorpusCount` when
    // `withFacets` returns an uncapped `ghost_badge` facet sum.
    limit: p.limit ?? 40,
    offset: p.offset ?? 0,
    sort: buildMeiliSort(p, legacy),
    ...(p.id ? {} : { attributesToRetrieve: [...JOB_LIST_ATTRIBUTES_TO_RETRIEVE] }),
    ...(opts?.rankingScoreDetails ? { showRankingScoreDetails: true } : {}),
  };
}

/**
 * One limit-0 Meilisearch count pass — `buildSearchBody`'s body for `p`,
 * pinned to `limit: 0, offset: 0`, POSTed through the shared `meiliFetch`
 * chokepoint. Shared by `searchMeili`'s tiered-retrieval branch (the
 * parallel tier-1 strict count that supplies `tier1Total`) and by
 * `/api/jobs/count` (the recall canary's `titled`/`wholeDoc` fields), so
 * "how many strict-scope/whole-document matches does this query have" is
 * computed identically wherever either number is needed — never re-derived
 * from a different call's result. Exported (not a `searchMeili`-local
 * closure) because the count route is a separate caller with no `intent`/
 * `companyScoped` resolution of its own to piggyback on.
 */
export async function runCountPass(
  h: string,
  p: JobSearchParams,
  opts: BuildSearchBodyOpts,
): Promise<number> {
  const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    cache: "no-store",
    body: JSON.stringify(buildSearchBody({ ...p, limit: 0, offset: 0 }, false, "all", opts)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Meilisearch count pass failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { estimatedTotalHits?: number; totalHits?: number; hits?: unknown[] };
  return body.totalHits ?? body.estimatedTotalHits ?? body.hits?.length ?? 0;
}

const POST_FILTER_PAGE_SIZE = 500;
const POST_FILTER_SCAN_CAP = 10_000;
const DOMAIN_POSTFILTER_NOTE =
  "Company domain filter applied locally — index filterableAttributes update pending";

/** TRANSITIONAL: scan Meili without domain filters and match in-app. */
async function searchWithDomainPostFilter(
  h: string,
  p: JobSearchParams,
  wholeDocument = false,
): Promise<JobSearchResult> {
  const offset = p.offset ?? 0;
  const limit = p.limit ?? 40;
  const needed = offset + limit;
  const matched: PublicJob[] = [];
  let scanned = 0;
  let facetDistribution: FacetDistribution | undefined;
  let legacy = false;
  let exhausted = false;
  const scanParams = { ...p, q: postFilterSearchQ(p) };

  for (let page = 1; ; page++) {
    const built = buildSearchBody(scanParams, legacy, "all", { skipDomainFilters: true, ...(wholeDocument ? { wholeDocument: true } : {}) });
    const { limit: _limit, offset: _offset, ...rest } = built;
    const body = {
      ...rest,
      hitsPerPage: POST_FILTER_PAGE_SIZE,
      page,
    };
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status === 400) {
      const text = await res.text().catch(() => "");
      if (/posted_ts/i.test(text) && !legacy) {
        console.warn("posted_ts not yet indexed — falling back to legacy sort/filter");
        legacy = true;
        page--;
        continue;
      }
      throw new Error(`Meilisearch search failed: ${res.status} ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meilisearch search failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const parsed = (await res.json()) as {
      hits: PublicJob[];
      facetDistribution?: Record<string, Record<string, number>>;
    };
    const hits = normalizePublicJobs(parsed.hits ?? []);
    scanned += hits.length;
    matched.push(...filterHitsByDomainFilters(hits, p));
    if (parsed.facetDistribution) facetDistribution = parsed.facetDistribution as FacetDistribution;

    if (hits.length < POST_FILTER_PAGE_SIZE) exhausted = true;
    if (matched.length >= needed || hits.length < POST_FILTER_PAGE_SIZE || scanned >= POST_FILTER_SCAN_CAP) break;
  }

  // total is matches found in the scan window only. Early stop (enough for
  // this page) or the 10k cap both mean more matches may exist — never claim
  // Meili's unfiltered totalHits.
  const lowerBound = !exhausted || scanned >= POST_FILTER_SCAN_CAP;
  const note = lowerBound
    ? `${DOMAIN_POSTFILTER_NOTE} (count is a lower bound)`
    : DOMAIN_POSTFILTER_NOTE;

  return {
    hits: matched.slice(offset, offset + limit),
    total: matched.length,
    backend: "meilisearch",
    configured: true,
    facetDistribution,
    note,
  };
}

/** Read-path: search the jobs index.
 *
 *  One strict pass (`matchingStrategy: "all"`). Company/title/tech-skill queries
 *  may scope `attributesToSearchOn`; default SERP retrieval is whole-document.
 *  Only a true query miss (`shouldRelaxSearch`: non-empty `q`, zero hits)
 *  triggers one expand pass — still `matchingStrategy: "all"`, unscoped — merged
 *  onto strict hits and flagged `widened` when extras land. */
/**
 * Sort-integrity chokepoint for `searchMeili`. `searchCutoffMs`
 * (`JOBS_INDEX_SETTINGS`) can interrupt a slow search under embed-batch/
 * indexing load and hand back partial results with the explicit `sort` only
 * PARTIALLY applied — a "FRESHEST" page that restarts its own order mid-list
 * (8 restarts observed in one 40-hit page, 2026-08-14 incident). Never render
 * an order we didn't verify: check the page against the sort it was asked
 * for, retry the identical search once (the degradation is transient — a
 * healthy retry takes ~40ms), and if the retry is STILL unsorted, re-sort
 * locally rather than ship disorder under a sort label. `runSearch` is
 * whatever produced `result` — strict pass, relaxed "last" pass, or the
 * `searchWithDomainPostFilter` path all funnel through this one call in
 * `searchMeili`, so one guard covers all three. Relevance mode is untouched:
 * there is no engine-decided order to verify. Explicit sorts verify the
 * whole page with `isPageSorted`.
 */
function sumDefined(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

async function applySortIntegrityGuard(
  result: JobSearchResult,
  p: JobSearchParams,
  runSearch: () => Promise<JobSearchResult>,
): Promise<JobSearchResult> {
  const mode = resolveEffectiveSort(p);
  if (mode === "relevance") return result;
  const verifiable = (hits: PublicJob[]) => sortVerifiableHits(hits, mode, p.q);
  if (isPageSorted(verifiable(result.hits), mode)) return result;

  // The retry is a second engine request: its time is counted with the first.
  const retried = await runSearch();
  const retry = {
    ...retried,
    engineMs: sumDefined(result.engineMs, retried.engineMs),
    engineCalls: sumDefined(result.engineCalls, retried.engineCalls),
  };
  if (isPageSorted(verifiable(retry.hits), mode)) return retry;

  console.warn("[jobs-search] sort-integrity: engine returned unsorted page, re-sorted locally", {
    q: p.q,
    mode,
  });
  return { ...retry, hits: [...retry.hits].sort((a, b) => compareJobsBySort(a, b, mode)) };
}

/**
 * Tiered retrieval for a bare role query (`isBareRoleQuery`): ONE federated
 * `/multi-search` blending tier 1 (strict title/company/tags scope, weight
 * 100 — byte-identical to `buildSearchBody(params, false, "all", {})`, the
 * pre-existing strict pass) ahead of tier 2 (whole-document, weight 1) into
 * a single deduplicated pool. Meilisearch's federation dedupes hits by
 * document id and unions the totals into `estimatedTotalHits` — verified
 * live (leg 7 A2-A5): the union total, strict-scope hits ranked first under
 * every sort (posted_ts included), continuing into whole-document-only
 * hits once the strict pool is exhausted. `total` here IS the whole-document
 * pool size — no separate "expand on zero hits" fallback, no merge step.
 *
 * `federation.limit`/`offset`/`facetsByIndex` carry what a per-query
 * `facets`/`limit`/`offset` would under a plain search — federation rejects
 * those per-query (400 `invalid_multi_search_query_facets`), so they're
 * stripped from each query body and moved to the federation envelope.
 * Facets requested only when the caller asked for them (`p.withFacets`),
 * using the same `REQUESTED_FACET_KEYS` the SERP has always requested.
 *
 * `tier1Total` — the strict-only count — comes from a parallel limit-0
 * `runCountPass` (shared with `/api/jobs/count`'s `titled` field) rather
 * than from the federated response: federation doesn't report a per-query
 * sub-total, only the union. This is what lets the client use a
 * server-supplied seam index instead of re-deriving it from loaded hits
 * (`firstMentionIndex`/`partitionByTitleMatch`), which reshuffles under an
 * explicit sort (leg 6 §2).
 *
 * No 400/posted_ts legacy retry here (unlike `runPass` below) and no
 * fallback to the old scoped-pass mechanism on failure — a federation error
 * surfaces like any other Meilisearch error.
 */
async function runTieredRetrieval(h: string, p: JobSearchParams): Promise<JobSearchResult> {
  // Relevance order only: the details feed `preferNewerAmongCloseMatches`.
  const rankingScoreDetails = resolveEffectiveSort(p) === "relevance";
  const strictBody = buildSearchBody(p, false, "all", rankingScoreDetails ? { rankingScoreDetails } : {});
  const wholeBody = buildSearchBody(p, false, "all", { wholeDocument: true, ...(rankingScoreDetails ? { rankingScoreDetails } : {}) });
  const { limit: _sLimit, offset: _sOffset, facets: _sFacets, ...strictQuery } = strictBody;
  const { limit: _wLimit, offset: _wOffset, facets: _wFacets, ...wholeQuery } = wholeBody;

  const federatedBody = {
    federation: {
      limit: p.limit ?? 40,
      offset: p.offset ?? 0,
      ...(p.withFacets ? { facetsByIndex: { [JOBS_INDEX]: [...REQUESTED_FACET_KEYS] } } : {}),
    },
    queries: [
      { ...strictQuery, indexUid: JOBS_INDEX, federationOptions: { weight: 100 } },
      { ...wholeQuery, indexUid: JOBS_INDEX, federationOptions: { weight: 1 } },
    ],
  };

  const [fedRes, tier1Total] = await Promise.all([
    meiliFetch(`${h}/multi-search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(federatedBody),
    }),
    runCountPass(h, p, {}),
  ]);

  if (!fedRes.ok) {
    const text = await fedRes.text().catch(() => "");
    throw new Error(`Meilisearch federated search failed: ${fedRes.status} ${text.slice(0, 300)}`);
  }
  const body = (await fedRes.json()) as {
    hits?: (PublicJob & { _federation?: { queriesPosition?: number } })[];
    estimatedTotalHits?: number;
    facetsByIndex?: Record<string, { distribution?: Record<string, Record<string, number>> }>;
  };
  // Per-hit provenance, not a carried count: `queriesPosition` reflects each
  // hit's OWN place in the federated `queries` array (0 = strict, 1 = whole
  // document) regardless of where a client-side filter later moves it in the
  // rendered list — see `PublicJob.tier` (types.ts) for why this beats
  // indexing into `hits` by `tier1Total`.
  const hits = normalizePublicJobs(
    (body.hits ?? []).map(({ _federation, ...hit }) => ({
      ...hit,
      tier: (_federation?.queriesPosition === 0 ? 1 : 2) as 1 | 2,
    })),
  );
  return {
    hits,
    total: body.estimatedTotalHits ?? body.hits?.length ?? 0,
    backend: "meilisearch",
    configured: true,
    facetDistribution: body.facetsByIndex?.[JOBS_INDEX]?.distribution as FacetDistribution | undefined,
    tier1Total,
  };
}

export async function searchMeili(p: JobSearchParams): Promise<JobSearchResult> {
  const h = host();
  if (!h) {
    return {
      hits: [],
      total: 0,
      backend: "meilisearch",
      configured: false,
      note: "MEILISEARCH_HOST not set",
    };
  }

  const intent = await resolveCompanyIntentResult(p.id ? undefined : p.q);

  // Inferred company narrowing (attributesToSearchOn:["company"] + the
  // company_domain pin below) can zero out a query that plainly has hits —
  // e.g. an employer whose postings don't lead with the bare company name in
  // the title/description. `runWithIntent` re-runs the whole pass with a
  // no-op intent when that happens, so the fallback covers every path below
  // (lanes' early return included), not just the plain-search tail. An
  // EXPLICIT `companyDomain`/`board` param never reaches here scoped — only
  // an inferred `intent.companyScoped` triggers the retry.
  const runWithIntent = async (intent: CompanyIntentResult): Promise<JobSearchResult> => {
    const companyScoped = intent.companyScoped;
    const searchParams = applyCompanyDomainPin(p, intent);

    const runSearch = async (params: JobSearchParams = searchParams): Promise<JobSearchResult> => {
      const needsDomain = needsDomainFilters(params);

      const runDomainPostFilter = (wholeDocument = false) =>
        searchWithDomainPostFilter(h, params, wholeDocument);

      if (companyDomainFilterUnsupported && needsDomain) {
        const strict = await runDomainPostFilter();
        if (!shouldRelaxSearch(strict.total, params.q ?? "")) return strict;
        const expanded = await runDomainPostFilter(true);
        return mergeExpandedIntoStrict(strict, expanded);
      }

      // Bare role query ("software engineer", "registered nurse", …, no
      // other lane claiming it): tiered federated retrieval replaces the
      // old "strict pass, expand only on zero hits" mechanism below for
      // THIS query class only — company-name/tech-skill/browse queries
      // still fall through to `runPass`. See `runTieredRetrieval`'s doc.
      if (isBareRoleQuery(params.q ?? "", companyScoped)) {
        return runTieredRetrieval(h, params);
      }

      // One extra round trip, memoized per query across requests
      // (`resolveCompanyIntentResult`), and only for free-text queries: an id probe,
      // a plain browse or a board/domain browse never asks. The domain
      // post-filter path above is deliberately excluded — those are
      // `board`/`companyDomain` browses that are ALREADY constrained to one
      // employer, so company-scoping the query text would add nothing.
      const rankingScoreDetails = resolveEffectiveSort(params) === "relevance";
      const runPass = async (wholeDocument = false): Promise<JobSearchResult> => {
        const post = (legacy: boolean) =>
          meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
            cache: "no-store",
            body: JSON.stringify(
              buildSearchBody(params, legacy, "all", {
                companyScoped,
                ...(wholeDocument ? { wholeDocument: true } : {}),
                ...(rankingScoreDetails ? { rankingScoreDetails } : {}),
              }),
            ),
          });

        let res = await post(false);
        if (!res.ok && res.status === 400) {
          const text = await res.text().catch(() => "");
          // TRANSITIONAL: posted_ts isn't sortable/filterable on the live index ye
          // (the settings PATCH + reindex run on the sync box, separately from this
          // deploy). Retry once without it instead of 400ing every search. Safe to
          // delete this branch once that reindex has landed.
          if (/posted_ts/i.test(text)) {
            console.warn("posted_ts not yet indexed — falling back to legacy sort/filter");
            res = await post(true);
          } else if (/company_domain/i.test(text) && needsDomain) {
            companyDomainFilterUnsupported = true;
            console.warn("company_domain not yet filterable — falling back to local post-filter");
            return runDomainPostFilter(wholeDocument);
          } else {
            throw new Error(`Meilisearch search failed: ${res.status} ${text.slice(0, 300)}`);
          }
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Meilisearch search failed: ${res.status} ${text.slice(0, 300)}`);
        }
        const body = (await res.json()) as {
          hits: PublicJob[];
          estimatedTotalHits?: number;
          totalHits?: number;
          facetDistribution?: Record<string, Record<string, number>>;
          processingTimeMs?: number;
        };
        return {
          hits: normalizePublicJobs(body.hits ?? []),
          total: body.totalHits ?? body.estimatedTotalHits ?? body.hits?.length ?? 0,
          backend: "meilisearch",
          configured: true,
          facetDistribution: body.facetDistribution as FacetDistribution | undefined,
          engineMs: body.processingTimeMs,
          engineCalls: 1,
        };
      };

      const strict = await runPass();
      if (!shouldRelaxSearch(strict.total, params.q ?? "")) return strict;

      // Strict/scoped pass returned zero — one whole-document expand pass
      // (`matchingStrategy: "all"`, no attribute scoping) merged onto stric
      // hits rather than replacing them. Flagged `widened` only when extras land.
      const expanded = await runPass(true);
      return mergeExpandedIntoStrict(strict, expanded);
    };

    const isRelevance = resolveEffectiveSort(p) === "relevance";
    let result: JobSearchResult;

    if (shouldRunCompanyScopedLanes(companyScoped, searchParams)) {
      const { lanes, facetDistribution } = await fetchCompanyScopedLanes(h, searchParams, companyScoped);
      const pool = assembleCompanyLanePool(lanes, (hits) =>
        isRelevance ? applyRelevanceQualityReranking(hits, p.q ?? "") : hits,
      );
      const offset = p.offset ?? 0;
      const limit = p.limit ?? 40;
      // A page past the pooled rows is served by the tail lane (the pooled ids
      // excluded), so the total can be the true match count instead of the pool size.
      const tailWindow = pool.tail ? companyLaneTailWindow(pool.hits.length, offset, limit) : null;
      const tail = pool.tail && tailWindow
        ? await searchCompanyLane(h, pool.tail, companyScoped, {
            ...tailWindow,
            withFacets: false,
            excludeIds: pool.hits.map((hit) => hit.id),
          })
        : null;
      // Lane-priority order IS the ranking for every sort — skip applySortIntegrityGuard
      // (same as relevance role-title lane; guard would flatten newest/salary lanes).
      return {
        hits: [...pageRoleTitleHits(pool.hits, offset, limit), ...(tail?.hits ?? [])],
        total: pool.total,
        ...(pool.inPlace !== undefined && { inPlace: pool.inPlace }),
        backend: "meilisearch",
        configured: true,
        facetDistribution,
      };
    }

    // A résumé-built search also looks for what the résumé shows in a posting's whole text (`contentPhrases`),
    // whatever the title says, so it runs the lanes even for a single title phrase.
    const contentPhrases = searchParams.fromResume && isRelevance ? sanitizeContentPhrases(searchParams.contentPhrases) : [];
    if (shouldRunFitPhraseLane(searchParams) || contentPhrases.length > 0) {
      const fitPhrases = resolveFitPhrases(searchParams) ?? singleTitlePhrase(searchParams.q);
      const [fetched, content] = await Promise.all([
        fetchFitPhraseLaneHits(h, searchParams, companyScoped, fitPhrases),
        contentPhrases.length > 0 ? fetchContentLaneHits(h, searchParams, companyScoped, contentPhrases, fitPhrases) : Promise.resolve(null),
      ]);
      const { facetDistribution } = fetched;
      // A lane whose own phrase names a role past Senior ("Staff Product Manager") was asked for by
      // that phrase, so it keeps its rows: only the résumé's other phrases drop them.
      const keepWithinSenior = (lane: PublicJob[]) => (p.omitPastSenior ? lane.filter(isWithinSenior) : lane);
      const lanes = p.omitPastSenior
        ? fetched.lanes.map((lane, i) => (titlePastSenior(fitPhrases[i] ?? "") ? lane : lane.filter(isWithinSenior)))
        : fetched.lanes;
      const seen = new Set<string>();
      const unique: PublicJob[] = [];
      for (const hit of [...lanes.flat(), ...(content ? keepWithinSenior([...content.placed.strong, ...content.placed.weak]) : [])]) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        unique.push(hit);
      }
      const offset = p.offset ?? 0;
      const limit = p.limit ?? 40;
      // Relevance: the content lanes' roles lead the first page; every title lane then gets a share of what is
      // left (`interleaveFitPhraseLanes`), each ranked against its own phrase, and, when a deck asked for them
      // (`unplacedRemote`), the roles that name no country take a few places at its end (`composeContentFirstPool`).
      const ranked = isRelevance
        ? composeContentFirstPool({
            content: content ? keepWithinSenior(content.placed.strong) : [],
            weak: content ? keepWithinSenior(content.placed.weak) : [],
            titleLanes: lanes.map((lane, i) => applyRelevanceQualityReranking(lane, fitPhrases[i] ?? p.q ?? "")),
            unplaced: searchParams.unplacedRemote && content ? keepWithinSenior(content.unplaced) : [],
            // The pool is composed for its first `FOR_YOU_POOL_WINDOW` rows (a smaller first page, the same shares);
            // a deeper first page (`FOR_YOU_READ_DEPTH`) or a later page reads on into the same composed list.
            window: offset === 0 ? Math.min(limit, FOR_YOU_POOL_WINDOW) : FOR_YOU_POOL_WINDOW,
          })
        : [...unique].sort((a, b) => compareJobsBySort(a, b, resolveEffectiveSort(p)));
      return {
        hits: pageRoleTitleHits(ranked, offset, limit),
        total: ranked.length,
        backend: "meilisearch",
        configured: true,
        facetDistribution,
      };
    }

    if (shouldRunRoleTitleLane(p.q ?? "", companyScoped)) {
      const { hits: laneHits, facetDistribution } = await fetchRoleTitleLaneHits(h, searchParams, companyScoped);
      const seen = new Set<string>();
      const unique: PublicJob[] = [];
      for (const hit of laneHits) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        unique.push(hit);
      }
      const ranked = isRelevance
        ? applyRelevanceQualityReranking(unique, p.q ?? "")
        : [...unique].sort((a, b) => compareJobsBySort(a, b, resolveEffectiveSort(p)));
      const offset = p.offset ?? 0;
      const limit = p.limit ?? 40;
      // `ranked` is already in final order (relevance rerank, or compareJobsBySort
      // for an explicit sort), so return directly and skip applySortIntegrityGuard —
      // same as the company-scoped lane above. The guard's retry calls runSearch(),
      // which has no notion of role-title membership, so letting it fire here would
      // silently swap the lane's pool back for the whole-corpus one.
      return {
        hits: pageRoleTitleHits(ranked, offset, limit),
        total: ranked.length,
        backend: "meilisearch",
        configured: true,
        facetDistribution,
      };
    }

    result = await runSearch();
    if (isRelevance && result.hits.length > 0) {
      // Rerank first, then newest-first among close matches: the reorder
      // keeps every hit in a slot the rerank gave its close-match group, so
      // the rerank's relevance tiers hold; it also strips the ranking-score
      // details. Relevance only — the sort-integrity guard below returns
      // early for relevance, so it can never flag (or re-sort) this page.
      result.hits = preferNewerAmongCloseMatches(applyRelevanceQualityReranking(result.hits, p.q), p.q);
    }

    return applySortIntegrityGuard(result, p, () => runSearch());
  };

  const result = await runWithIntent(intent);
  if (intent.companyScoped && result.total === 0) {
    const fallback = await runWithIntent({ companyScoped: false, companyDomains: [] });
    return {
      ...fallback,
      companyIntent: { domains: intent.companyDomains, scopedTotal: 0, fallback: true },
    };
  }
  return result;
}

export function pageRoleTitleHits(ranked: PublicJob[], offset: number, limit: number): PublicJob[] {
  return ranked.slice(offset, offset + limit);
}

const COMPANY_LANE_HIT_LIMIT = 100;

/**
 * One window of one company-scoped lane. Pinned to relevance regardless of the
 * caller's requested sort: the first fetch is capped at COMPANY_LANE_HIT_LIMIT,
 * and a capped fetch's top-N is only stable when the ORDER BY is fixed — under
 * newest/salary_desc the same cap would silently admit a different top-N per
 * sort, making lane membership sort-dependent. `total` is what the lane matches
 * in all, not the window's size; `excludeIds` drops rows already pooled.
 */
async function searchCompanyLane(
  h: string,
  laneParams: JobSearchParams,
  companyScoped: boolean,
  window: { limit: number; offset: number; withFacets: boolean; excludeIds?: string[] },
  legacy = false,
): Promise<{ hits: PublicJob[]; total: number; facetDistribution?: FacetDistribution }> {
  const body = buildSearchBody(
    { ...laneParams, withFacets: window.withFacets, limit: window.limit, offset: window.offset, sort: "relevance" },
    legacy,
    "all",
    { companyScoped },
  );
  if (window.excludeIds?.length) body.filter.push(`NOT id IN ${JSON.stringify(window.excludeIds)}`);
  const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status === 400) {
    const text = await res.text().catch(() => "");
    if (/posted_ts/i.test(text) && !legacy) {
      return searchCompanyLane(h, laneParams, companyScoped, window, true);
    }
    return { hits: [], total: 0 };
  }
  if (!res.ok) return { hits: [], total: 0 };
  const json = (await res.json()) as {
    hits?: PublicJob[];
    estimatedTotalHits?: number;
    totalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  };
  return {
    hits: normalizePublicJobs(json.hits ?? []),
    total: json.totalHits ?? json.estimatedTotalHits ?? 0,
    facetDistribution: json.facetDistribution as FacetDistribution | undefined,
  };
}

async function fetchCompanyScopedLanes(
  h: string,
  p: JobSearchParams,
  companyScoped: boolean,
): Promise<{ lanes: CompanyLaneFetch[]; facetDistribution?: FacetDistribution }> {
  const laneParams = buildCompanyScopedSearchLanes(p);
  const batches = await Promise.all(
    laneParams.map((params, i) =>
      searchCompanyLane(h, params, companyScoped, {
        limit: COMPANY_LANE_HIT_LIMIT,
        offset: 0,
        withFacets: i === 0 && !!p.withFacets,
      }),
    ),
  );
  return {
    lanes: laneParams.map((params, i) => ({ params, hits: batches[i].hits, total: batches[i].total })),
    facetDistribution: batches[0]?.facetDistribution,
  };
}

/** Not a role past Senior (`omitPastSenior`, types.ts). */
function isWithinSenior(hit: PublicJob): boolean {
  return !titlePastSenior(hit.title) && !listedPastSenior(hit.experience_level);
}

function fitPhraseTitleScoped(phrase: string): boolean {
  return phrase.trim().split(/\s+/).length >= 2;
}

/**
 * One ranked list from the fit-phrase lanes, phrase order = strength order: page
 * slots go to the lanes in proportion to n, n-1, …, 1 (smooth weighted round
 * robin), so with four phrases every 10 rows hold about 4, 3, 2 and 1 from
 * each. A row two lanes found keeps its first slot; an empty lane gives its
 * share to the rest.
 *
 * Before (2026-10-01), the union was ranked against the FIRST phrase's title
 * alone, so a page held only that phrase's rows until they ran out: a résumé
 * whose pack searched "Product Manager" first and "Customer Success Manager"
 * second got 60 Product Manager rows and not one Customer Success role, and
 * the device, which ranks only the rows it was sent, could not put them first.
 */
export function interleaveFitPhraseLanes(lanes: readonly (readonly PublicJob[])[]): PublicJob[] {
  const weight = lanes.map((_, i) => lanes.length - i);
  const credit = lanes.map(() => 0);
  const next = lanes.map(() => 0);
  const seen = new Set<string>();
  const out: PublicJob[] = [];
  const advance = (i: number) => {
    while (next[i] < lanes[i].length && seen.has(lanes[i][next[i]].id)) next[i]++;
    return next[i] < lanes[i].length;
  };
  for (;;) {
    const live = lanes.map((_, i) => i).filter(advance);
    if (live.length === 0) return out;
    const total = live.reduce((sum, i) => sum + weight[i], 0);
    for (const i of live) credit[i] += weight[i];
    const pick = live.reduce((best, i) => (credit[i] > credit[best] ? i : best), live[0]);
    credit[pick] -= total;
    const hit = lanes[pick][next[pick]++];
    seen.add(hit.id);
    out.push(hit);
  }
}

async function fetchFitPhraseLaneHits(
  h: string,
  p: JobSearchParams,
  companyScoped: boolean,
  titlePhrases?: readonly string[],
): Promise<{ lanes: PublicJob[][]; facetDistribution?: FacetDistribution }> {
  const phrases = titlePhrases ?? resolveFitPhrases(p);
  if (!phrases || phrases.length === 0) return { lanes: [] };

  const searchPhrase = async (
    phrase: string,
    withFacets: boolean,
    legacy: boolean,
  ): Promise<{ hits: PublicJob[]; facetDistribution?: FacetDistribution }> => {
    const body = buildSearchBody(
      {
        ...p,
        q: phrase,
        fitPhrases: undefined,
        withFacets,
        limit: 1000,
        offset: 0,
        sort: "relevance",
      },
      legacy,
      "all",
      { companyScoped, titleScoped: fitPhraseTitleScoped(phrase) },
    );
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status === 400) {
      const text = await res.text().catch(() => "");
      if (/posted_ts/i.test(text) && !legacy) {
        return searchPhrase(phrase, withFacets, true);
      }
      return { hits: [] };
    }
    if (!res.ok) return { hits: [] };
    const json = (await res.json()) as {
      hits?: PublicJob[];
      facetDistribution?: Record<string, Record<string, number>>;
    };
    return {
      hits: normalizePublicJobs(json.hits ?? []),
      facetDistribution: json.facetDistribution as FacetDistribution | undefined,
    };
  };

  const batches = await Promise.all(
    phrases.map((phrase, i) => searchPhrase(phrase, i === 0 && !!p.withFacets, false)),
  );
  return {
    lanes: batches.map((b) => b.hits),
    facetDistribution: batches[0]?.facetDistribution,
  };
}

/** A résumé search with one title phrase (no `"A" OR "B"`): that phrase, cleaned, or none. */
function singleTitlePhrase(q: string | undefined): string[] {
  const phrase = (q ?? "").replace(/"/g, "").trim();
  return phrase ? [phrase] : [];
}

/** How many rows each content lane reads. */
export const CONTENT_LANE_LIMIT = 100;
/** How many rows each lane for roles that name no country reads. */
export const UNPLACED_REMOTE_LANE_LIMIT = 100;
/** The window the pool is composed for: its first 150 rows. A deck reads on past it (`FOR_YOU_READ_DEPTH`, pack-filters.ts) into the title lanes' next rows. */
export const FOR_YOU_POOL_WINDOW = 150;
/** The most roles that name no country a deck pools beside the placed ones. */
export const UNPLACED_REMOTE_POOL = 20;
/**
 * The places in a first page of 150 the title lanes keep whatever the content lanes found (content claims the
 * rest: 90 with no-country roles, 110 without). A content lane that read a posting wrong cannot empty the
 * pool of the roles whose title the résumé names.
 */
export const TITLE_POOL_FLOOR = 40;
/**
 * The most places in a first page of 150 for roles only ONE content lane found. One phrase in a posting is
 * weak evidence, and a phrase many postings mention ("product roadmap") fills its 100 rows with arbitrary ones:
 * left alone it crowded out the title lanes (a Technical Account Manager résumé listing "product roadmap"
 * pooled a hundred Product Manager roles and lost 35 of its 56 own). A role several lanes found is not limited.
 */
export const CONTENT_SINGLE_LANE_POOL = 20;

/**
 * Postings in the order of how many of the lanes found them (the phrases they mention), then how early the
 * lanes found them (rank 1 of any lane before rank 2 of any, so no lane's rows crowd out another's), then the
 * lane order: a posting that mentions the résumé's roadmap work AND its release work outranks one that mentions
 * only one, and a posting only one lane found is placed by where that lane put it, not by the lane's number.
 * `strong` are the postings two or more lanes found, `weak` the ones only one found. Pure.
 */
export function voteContentLanes(lanes: readonly (readonly PublicJob[])[]): { strong: PublicJob[]; weak: PublicJob[] } {
  const found = new Map<string, { job: PublicJob; votes: number; rank: number; lane: number }>();
  lanes.forEach((lane, laneIndex) => {
    lane.forEach((job, rank) => {
      const entry = found.get(job.id);
      if (!entry) found.set(job.id, { job, votes: 1, rank, lane: laneIndex });
      else {
        entry.votes++;
        if (rank < entry.rank) entry.rank = rank;
      }
    });
  });
  const ordered = [...found.values()].sort((a, b) => b.votes - a.votes || a.rank - b.rank || a.lane - b.lane);
  return { strong: ordered.filter((e) => e.votes > 1).map((e) => e.job), weak: ordered.filter((e) => e.votes === 1).map((e) => e.job) };
}

/**
 * The lanes a résumé-built search adds to its title lanes (`JobSearchParams.contentPhrases`):
 *  - `placed`: postings whose whole text mentions a phrase the résumé shows, whatever their title says,
 *    under the same filters as the title lanes (so only roles in the person's countries), one lane per
 *    phrase and the postings several phrases find first (`voteContentLanes`). A phrase of one word (a tool,
 *    a method, a domain) only counts if it is rare: the lane read every posting that mentions it
 *    (`CONTENT_LANE_LIMIT`).
 *  - `unplaced`, when `unplacedRemote`: remote roles that name no country, city or state, which the country
 *    filter leaves out of every other lane (`REMOTE_ANYWHERE_CLAUSE`), found by the first two content
 *    phrases of two words and by the first title phrase. A deck lists them last with the caveat ("Remote,
 *    country not stated"); Today and the daily picks do not ask for them.
 * Scoring against the whole résumé happens afterwards, as for every lane.
 */
async function fetchContentLaneHits(
  h: string,
  p: JobSearchParams,
  companyScoped: boolean,
  phrases: readonly string[],
  titlePhrases: readonly string[],
): Promise<{ placed: { strong: PublicJob[]; weak: PublicJob[] }; unplaced: PublicJob[] }> {
  const run = async (q: string, params: JobSearchParams, limit: number, scope: BuildSearchBodyOpts, extraFilter?: string): Promise<{ hits: PublicJob[]; total: number }> => {
    const body = buildSearchBody({ ...params, q, fitPhrases: undefined, withFacets: false, limit, offset: 0, sort: "relevance" }, false, "all", scope);
    if (extraFilter && Array.isArray(body.filter)) body.filter = [...body.filter, extraFilter];
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok) return { hits: [], total: 0 };
    const json = (await res.json()) as { hits?: PublicJob[]; totalHits?: number; estimatedTotalHits?: number };
    const hits = normalizePublicJobs(json.hits ?? []);
    return { hits, total: json.totalHits ?? json.estimatedTotalHits ?? hits.length };
  };
  // Both words anywhere in the posting's text (not as an exact phrase: a posting says "roadmap" and "vision" in different sentences).
  const phraseQuery = (phrase: string) => phrase;
  const wholeDoc: BuildSearchBodyOpts = { companyScoped, wholeDocument: true };
  const isWord = (phrase: string) => !phrase.includes(" ");
  const placed = Promise.all(phrases.map((phrase) => run(phraseQuery(phrase), p, CONTENT_LANE_LIMIT, wholeDoc))).then((lanes) =>
    // A one-word lane counts only when it read EVERY posting that mentions the word: a word more of them mention
    // ("roadmap", "sql") is read through its first 100 rows, which are arbitrary ones, and says nothing about a posting.
    voteContentLanes(lanes.filter((lane, i) => !isWord(phrases[i]!) || (lane.total > 0 && lane.total <= CONTENT_LANE_LIMIT)).map((lane) => lane.hits)),
  );
  if (!p.unplacedRemote) return { placed: await placed, unplaced: [] };
  // The country facet is what leaves these roles out; every other filter (level, posted window) stays.
  const noCountry: JobSearchParams = { ...p, places: undefined, facets: { ...p.facets, location_country: undefined } };
  const remoteNoCountry = `(${REMOTE_ANYWHERE_CLAUSE})`;
  const unplacedLanes = Promise.all([
    ...titlePhrases.slice(0, 1).map((phrase) =>
      run(phrase, noCountry, UNPLACED_REMOTE_LANE_LIMIT, { companyScoped, titleScoped: fitPhraseTitleScoped(phrase) }, remoteNoCountry),
    ),
    ...phrases.filter((phrase) => !isWord(phrase)).slice(0, 2).map((phrase) => run(phraseQuery(phrase), noCountry, UNPLACED_REMOTE_LANE_LIMIT, wholeDoc, remoteNoCountry)),
  ]);
  const [placedRows, lanes] = await Promise.all([placed, unplacedLanes]);
  return { placed: placedRows, unplaced: interleaveFitPhraseLanes(lanes.map((lane) => lane.hits)) };
}

/**
 * The pool a résumé-built search hands the browser to score, for a first page of `window` rows (the deck's
 * is `FOR_YOU_POOL_WINDOW`): the content lanes lead and the title lanes fill what is left. The résumé's
 * content decides who is in the pool; the title only fills (Vivek, 2026-10-14: "FIRST match the résumé's
 * experience and skills content to the posting, the title LAST").
 *  - content: up to everything the title lanes' floor and the no-country places leave (90 of 150): first the
 *    postings TWO or more content lanes found (`strong`: two different things the résumé shows are in the
 *    posting), whatever their title, then up to `CONTENT_SINGLE_LANE_POOL` (20) of the postings only one lane
 *    found (`weak`);
 *  - the title lanes (`interleaveFitPhraseLanes`) fill the rest, with at least `TITLE_POOL_FLOOR` places
 *    (40 of 150) however much the content lanes found, and every place the content lanes did not use;
 *  - up to `UNPLACED_REMOTE_POOL` places (20) for remote roles that name no country, listed last by the deck.
 * A smaller window (the hub's first probe steps, Today) gives the same shares of its places, not the same
 * number. A later page slices the same composed list: the title lanes' rows past the window follow.
 */
export function composeContentFirstPool(args: {
  content: readonly PublicJob[];
  /** Postings only one content lane found. */
  weak?: readonly PublicJob[];
  titleLanes: readonly (readonly PublicJob[])[];
  unplaced: readonly PublicJob[];
  window: number;
}): PublicJob[] {
  const titles = interleaveFitPhraseLanes([...args.titleLanes]);
  const share = Math.min(1, args.window / FOR_YOU_POOL_WINDOW);
  const unplacedQuota = args.unplaced.length > 0 ? Math.min(args.window, Math.ceil(UNPLACED_REMOTE_POOL * share)) : 0;
  const titleFloor = Math.min(args.window - unplacedQuota, Math.ceil(TITLE_POOL_FLOOR * share));
  const contentQuota = Math.max(0, args.window - unplacedQuota - titleFloor);
  const fromStrong = args.content.slice(0, contentQuota);
  const weak = (args.weak ?? []).filter((job) => !fromStrong.some((s) => s.id === job.id));
  const fromWeak = weak.slice(0, Math.min(Math.ceil(CONTENT_SINGLE_LANE_POOL * share), contentQuota - fromStrong.length));
  const fromContent = [...fromStrong, ...fromWeak];
  const contentIds = new Set(fromContent.map((job) => job.id));
  const fromUnplaced = args.unplaced.filter((job) => !contentIds.has(job.id)).slice(0, unplacedQuota);
  const unplacedIds = new Set(fromUnplaced.map((job) => job.id));
  const rest = titles.filter((job) => !contentIds.has(job.id) && !unplacedIds.has(job.id));
  // Every place the content and no-country lanes did not use goes to the title lanes' next rows...
  const fromTitles = rest.slice(0, Math.max(0, args.window - fromContent.length - fromUnplaced.length));
  const titleIds = new Set(fromTitles.map((job) => job.id));
  // ...and when the title lanes have too few rows for them (a niche résumé), to the content lanes' next rows.
  const spare = Math.max(0, args.window - fromContent.length - fromTitles.length - fromUnplaced.length);
  const later = [...args.content.slice(contentQuota), ...weak.slice(fromWeak.length)].filter((job) => !titleIds.has(job.id) && !unplacedIds.has(job.id));
  const moreContent = later.slice(0, spare);
  const usedIds = new Set([...titleIds, ...moreContent.map((job) => job.id)]);
  // Pages after the first: the title lanes' next rows, then the content rows still unplaced.
  const tail: PublicJob[] = [];
  for (const job of [...rest.slice(fromTitles.length), ...later.slice(spare)]) {
    if (usedIds.has(job.id)) continue;
    usedIds.add(job.id);
    tail.push(job);
  }
  return [...fromContent, ...fromTitles, ...moreContent, ...fromUnplaced, ...tail];
}

async function fetchRoleTitleLaneHits(
  h: string,
  p: JobSearchParams,
  companyScoped: boolean,
): Promise<{ hits: PublicJob[]; facetDistribution?: FacetDistribution }> {
  const pairs = roleTitlePairQueries(p.q ?? "");
  if (pairs.length === 0) return { hits: [] };

  const searchPair = async (
    pairQ: string,
    withFacets: boolean,
    legacy: boolean,
  ): Promise<{ hits: PublicJob[]; facetDistribution?: FacetDistribution }> => {
    // Pinned to relevance for the same reason as searchCompanyLane
    // above: each pair query is capped at 1000 hits, and a fixed cap is only
    // safe under a fixed order — some pairs (e.g. "director product") match
    // well over 1000 docs, so a sort-varying top-1000 would make the lane's
    // deduped pool size drift by the requested sort instead of staying a
    // permutation of one set. `searchMeili` re-orders the union afterward.
    const body = buildSearchBody(
      { ...p, q: pairQ, withFacets, limit: 1000, offset: 0, sort: "relevance" },
      legacy,
      "all",
      { companyScoped, titleScoped: true },
    );
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status === 400) {
      const text = await res.text().catch(() => "");
      if (/posted_ts/i.test(text) && !legacy) {
        return searchPair(pairQ, withFacets, true);
      }
      return { hits: [] };
    }
    if (!res.ok) return { hits: [] };
    const json = (await res.json()) as {
      hits?: PublicJob[];
      facetDistribution?: Record<string, Record<string, number>>;
    };
    return {
      hits: normalizePublicJobs(json.hits ?? []),
      facetDistribution: json.facetDistribution as FacetDistribution | undefined,
    };
  };

  const batches = await Promise.all(
    pairs.map((pairQ, i) => searchPair(pairQ, i === 0 && !!p.withFacets, false)),
  );
  return {
    hits: batches.flatMap((b) => b.hits),
    facetDistribution: batches[0]?.facetDistribution,
  };
}

const NON_TECH_ROLE_REGEX = /\b(therapist|nurse|nursing|physician|dental|dentist|driver|paramedic|phlebotomist|teacher|substitute teacher|caregiver|cook|waiter|bus monitor|janitor|custodian)\b/i;

/** Per-query inputs to the relevance rerank's leading keys, resolved once. */
interface RelevanceRerankContext {
  query: string;
  isTech: boolean;
  rolePair: boolean;
}

function relevanceRerankContext(q?: string): RelevanceRerankContext {
  const query = (q ?? "").trim().toLowerCase();
  return { query, isTech: isTechSkillQuery(query), rolePair: Boolean(query) && roleTitlePairQueries(query).length > 0 };
}

/**
 * The rerank's relevance keys for one hit, lower = better, compared in
 * order: (0) a non-tech title on a tech query, (0b) a title that misses the
 * role-title query's shape, (1) minus the title-token coverage score. Shared
 * by `applyRelevanceQualityReranking` and `preferNewerAmongCloseMatches` so
 * the two can never disagree about which hits are equally relevant.
 */
function relevanceTierKey(hit: PublicJob, ctx: RelevanceRerankContext): [number, number, number] {
  const title = decodeText(hit.title);
  return [
    ctx.isTech && NON_TECH_ROLE_REGEX.test(title) ? 1 : 0,
    ctx.rolePair && !titleSatisfiesRoleQuery(title, ctx.query) ? 1 : 0,
    ctx.query ? -titleRelevanceScore(title, ctx.query) : 0,
  ];
}

function compareTierKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Posting-age buckets the rerank prefers newer within: up to 3 days, a week, two weeks, a month, older. */
const FRESHNESS_BUCKET_DAYS = [3, 7, 14, 30] as const;
const DAY_MS = 86_400_000;

/** Lower = fresher. Unknown age sorts with the oldest. */
export function freshnessBucket(job: PublicJob, nowMs: number = Date.now()): number {
    const ts = job.posted_ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return FRESHNESS_BUCKET_DAYS.length;
    const days = Math.max(0, (nowMs - ts) / DAY_MS);
    const i = FRESHNESS_BUCKET_DAYS.findIndex((limit) => days <= limit);
    return i === -1 ? FRESHNESS_BUCKET_DAYS.length : i;
}

/**
 * Post-search relevance & quality reranking for default/relevance searches:
 * 0. Demotes non-tech titles on tech queries (e.g. "Therapist at Rust Medical Center" when searching "Rust").
 * 1. Title-token coverage score (`titleRelevanceScore`).
 * 2. Posting age, in buckets (`freshnessBucket`): among equally relevant
 *    titles a role posted this week leads one posted last month.
 * 3. Transparent compensation disclosure (salary_min > 0 or salary_max > 0).
 * 4. Ghost tier: a likely ghost last, a caution after the rest. A posting not
 *    checked yet ranks with a checked-clear one.
 * 5. Recency tie-breaker.
 *
 * Before 2026-10-13 salary and a "clear" ghost check came BEFORE age. New
 * postings are the ones not ghost-checked yet, and about half list no pay,
 * so a Product Manager pack in Canada led with 35 salaried roles up to 28
 * days old and put a 2-day-old Intact posting at #38 — past the 60 rows a
 * pack loads, for most of the pool (measured live, review 2026-10-13).
 */
export function applyRelevanceQualityReranking(hits: PublicJob[], q?: string, nowMs: number = Date.now()): PublicJob[] {
  if (!hits || hits.length <= 1) return hits;
  const ctx = relevanceRerankContext(q);
  const ghostScore = (g: string) => (g === "likely_ghost" ? 0 : g === "caution" ? 1 : 2);
  const hasSalary = (j: PublicJob) => ((j.salary_min != null && j.salary_min > 0) || (j.salary_max != null && j.salary_max > 0) ? 1 : 0);
  const keyed = hits.map((hit) => ({ hit, tier: relevanceTierKey(hit, ctx), fresh: freshnessBucket(hit, nowMs) }));

  keyed.sort((x, y) => {
    const a = x.hit;
    const b = y.hit;
    // 0, 0b, 1. Relevance tier (non-tech demotion, role-title shape, title coverage).
    const tier = compareTierKeys(x.tier, y.tier);
    if (tier !== 0) return tier;

    // 2. Posting age bucket (fresher first).
    if (x.fresh !== y.fresh) return x.fresh - y.fresh;

    // 3. Salary disclosure boost (disclosed pay is high signal for job seekers)
    const salary = hasSalary(b) - hasSalary(a);
    if (salary !== 0) return salary;

    // 4. Ghost status tiering (clear/unchecked > caution > likely_ghost)
    const ghost = ghostScore(b.ghost_badge) - ghostScore(a.ghost_badge);
    if (ghost !== 0) return ghost;

    // 5. Recency tie-break (posted_ts)
    return (b.posted_ts ?? 0) - (a.posted_ts ?? 0);
  });
  return keyed.map((k) => k.hit);
}

/**
 * The ranking rules that decide whether two hits match the query equally
 * well: `words`, `typo`, `proximity`, `attributeRank` — every rule in
 * `JOBS_INDEX_SETTINGS.rankingRules` ahead of `wordPosition`/`exactness`
 * (`sort` sits between them but is inert without a `sort` param, which is
 * the only mode this runs in). Meilisearch omits `words` under
 * `matchingStrategy: "all"`, where every hit matches every word; a rule
 * absent from both hits compares equal.
 */
const CLOSE_MATCH_RULES = ["words", "typo", "proximity", "attributeRank"] as const;

type RankingScoreDetails = Partial<Record<string, { score?: number }>>;
type HitWithRankingDetails = PublicJob & { _rankingScoreDetails?: RankingScoreDetails };

/** Stable key of a hit's close-match group, or `null` when the engine sent no details for it. */
function closeMatchKey(hit: HitWithRankingDetails, ctx: RelevanceRerankContext): string | null {
  const details = hit._rankingScoreDetails;
  if (!details) return null;
  return JSON.stringify([
    // Federated tiers are separate queries; their scores are not comparable.
    hit.tier ?? 0,
    ...CLOSE_MATCH_RULES.map((rule) => details[rule]?.score ?? null),
    ...relevanceTierKey(hit, ctx),
  ]);
}

function postedTsOrOldest(job: PublicJob): number {
  return typeof job.posted_ts === "number" && Number.isFinite(job.posted_ts) ? job.posted_ts : Number.NEGATIVE_INFINITY;
}

function withoutRankingScoreDetails(hit: PublicJob): PublicJob {
  if (!("_rankingScoreDetails" in hit)) return hit;
  const { _rankingScoreDetails: _details, ...rest } = hit as HitWithRankingDetails;
  return rest;
}

/**
 * Newer first among close matches, within ONE returned page (2026-09-30,
 * approved). The index ranks by words, typo, proximity, attributeRank,
 * wordPosition, exactness and only then `posted_ts:desc`, so recency breaks
 * exact ties alone: an exact "Data Analyst" posted 80 days ago outranked a
 * "Senior Data Analyst" posted yesterday on nothing but word position and
 * exactness. Index settings stay as they are; this works at query time off
 * `showRankingScoreDetails` (requested only for relevance-sorted typed
 * searches — `rankingScoreDetails` in `buildSearchBody`).
 *
 * Hits that tie on `CLOSE_MATCH_RULES` (so differ only in word position and
 * exactness), come from the same federated tier, and share the rerank's
 * relevance tier (`relevanceTierKey`) form one group. Each group keeps the
 * page slots it already holds and refills them newest `posted_ts` first
 * (stable). Nothing else moves: no hit changes page, so pagination and
 * totals are untouched, and because a group only swaps slots among its own
 * members, every relevance-tier boundary the rerank drew still holds.
 * Page-bound by design: when one page holds both of the example's rows, the
 * newer one now leads; when older exact titles fill whole pages ahead of
 * it, the newer one still starts on a later page. Inside a group, recency
 * now outranks the rerank's salary-disclosure and ghost-tier boosts, which
 * is the point: those still order hits that are NOT close matches. A hit
 * with no details (a lane, the domain post-filter scan) stays where it is.
 *
 * Always returns hits WITHOUT `_rankingScoreDetails` — the engine's scoring
 * never leaves the server.
 */
export function preferNewerAmongCloseMatches(hits: PublicJob[], q?: string): PublicJob[] {
  const ctx = relevanceRerankContext(q);
  const slotsByGroup = new Map<string, number[]>();
  hits.forEach((hit, index) => {
    const key = closeMatchKey(hit as HitWithRankingDetails, ctx);
    if (key === null) return;
    const slots = slotsByGroup.get(key);
    if (slots) slots.push(index);
    else slotsByGroup.set(key, [index]);
  });
  const ordered = [...hits];
  for (const slots of slotsByGroup.values()) {
    if (slots.length < 2) continue;
    const newestFirst = slots.map((i) => hits[i]).sort((a, b) => postedTsOrOldest(b) - postedTsOrOldest(a) || 0);
    slots.forEach((slot, i) => {
      ordered[slot] = newestFirst[i];
    });
  }
  return ordered.map(withoutRankingScoreDetails);
}

/** The three location fields a parsed place can constrain. */
export const LOCATION_FACET_FIELDS = ["location_city", "location_state", "location_country"] as const;

/** True when a `work_type` facet value looks like "remote" for whatever this
 *  corpus happens to call it — never a hardcoded `"remote"` string, since the
 *  upstream feed's casing/spelling isn't a contract ("Remote", "remote_us",
 *  etc. must all match). Single source of truth for that test: picking the
 *  live remote facet VALUE out of a distribution (`pickRemoteFacetValue`,
 *  FilterChipsRow.tsx) and recognizing an already-committed remote selection
 *  from filter state alone (`locationTriggerLabel`, jobs/location-label.ts)
 *  both call this rather than each keeping its own regex. */
export function isRemoteWorkTypeValue(value: string): boolean {
  return /remote/i.test(value);
}

/**
 * Read-path: does a specific candidate STRING exist as a value in a given
 * facet — the corpus validation layer behind gazetteer-backed place
 * resolution (lib/geo/corpus-values.ts). Meilisearch's facet-search endpoint
 * is typeahead-shaped (find values matching a query), which is exactly what
 * "does the corpus have this place" needs — unlike a bulk facet distribution
 * fetch (which only ever surfaces the top values by count), this reaches a
 * specific value regardless of how far down the long tail it sits. Measured
 * live against the box 2026-08-05: ~40ms per call.
 *
 * Always constrained by `LIVE_VACANCY_FILTER` (via `withLiveVacancyFilter`),
 * same as every real search (`buildFilter`) — a value counted here that only
 * exists on closed postings would advertise a number the actual search can
 * never deliver.
 *
 * Also the source of the bare-work-mode location suggestion's count
 * (`buildWorkModeSuggestion`, location-suggest.ts) — `field: "work_type"`
 * with an empty `query` browses every work_type value's own total, which is
 * exactly "how many jobs are remote" with no place filter mixed in.
 *
 * Returns null on ANY failure (no backend configured, network error,
 * non-2xx) — the caller (createCorpusValueChecker) treats that as "couldn't
 * ask" and fails the candidate open rather than caching a false negative.
 */
export async function fetchFacetSearch(
  field: (typeof LOCATION_FACET_FIELDS)[number] | "work_type",
  query: string,
  /** Narrows the counts on top of `LIVE_VACANCY_FILTER` (always applied —
   *  see `withLiveVacancyFilter`), e.g. `work_type = "remote"`. Meili applies
   *  the composed filter to the facet search itself, so the number returned
   *  is the true intersection rather than the facet value's total — which is
   *  what lets the location picker show a work-mode-qualified count it can
   *  actually deliver. */
  filter?: string,
): Promise<{ value: string; count: number }[] | null> {
  const h = host();
  if (!h) return null;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/facet-search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({ facetName: field, facetQuery: query, filter: withLiveVacancyFilter(filter) }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { facetHits?: { value: string; count: number }[] };
    return body.facetHits ?? [];
  } catch {
    return null;
  }
}

/** One filter+facet aggregation query against the jobs index — the shape
 *  Meilisearch's `/multi-search` endpoint batches. No `q`/sort/paging: this
 *  is read-path aggregation only (see `meiliMultiSearch`), never a search. */
export interface MeiliAggregationQuery {
  filter?: string[];
  facets?: string[];
}

/** One `/multi-search` result. `facetDistribution` values are the uncapped
 *  counts (see corpus-count.ts); `totalHits`/`estimatedTotalHits` are
 *  subject to `JOBS_INDEX_SETTINGS.pagination.maxTotalHits` like any other
 *  search response. */
export interface MeiliAggregationResult {
  estimatedTotalHits?: number;
  totalHits?: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

/**
 * Mirrors `src/app/trends/page.tsx`'s `export const revalidate`. Next's
 * route-segment config must be a literal (it's statically parsed, not
 * executed), so it can't just import this — same constraint corpus-count.ts
 * documents for its own `CORPUS_COUNT_CAP`/`MAX_REACHABLE` pair. Keep both
 * literals in sync by hand if the ISR window ever changes.
 */
const TRENDS_REVALIDATE_SECONDS = 1800;

/**
 * Read-path: batch N filter+facet aggregation queries into ONE
 * `/multi-search` HTTP round trip. Built for the /trends page (market-wide
 * hero stats, country rollup, posting-freshness bands, ghost radar), whose
 * ISR revalidation needs many independent facet breakdowns without firing a
 * facet-storm of individual requests at a box that's already measured at
 * 4-7s per plain facet query under embed-backfill load. Reuses `meiliFetch`
 * — the shared per-attempt-timeout + bounded-retry chokepoint — rather than
 * a second bespoke fetch wrapper.
 *
 * Deliberately NOT `cache: "no-store"` (unlike every other read-path call in
 * this file): those back a real-time search box that must never serve stale
 * results, while this backs an ISR page that must NOT hit Meilisearch per
 * visitor. `next.revalidate` puts this fetch in Next's Data Cache instead,
 * which is what actually makes `export const revalidate` on the page take
 * effect — a `no-store` fetch anywhere in a route forces that whole route
 * to render dynamically (measured: `/trends` came back `ƒ` dynamic in the
 * build report until this was fixed).
 *
 * Throws on failure (network, non-2xx) so a caller can't silently render a
 * fabricated zero; see market-trends.ts for how the /trends page treats
 * that.
 */
export async function meiliMultiSearch(
  queries: MeiliAggregationQuery[],
): Promise<MeiliAggregationResult[]> {
  const h = host();
  if (!h) throw new Error("MEILISEARCH_HOST not set");
  const res = await meiliFetch(`${h}/multi-search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    next: { revalidate: TRENDS_REVALIDATE_SECONDS },
    body: JSON.stringify({
      queries: queries.map((q) => ({
        indexUid: JOBS_INDEX,
        q: "",
        limit: 0,
        ...(q.filter?.length ? { filter: q.filter } : {}),
        ...(q.facets?.length ? { facets: q.facets } : {}),
      })),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Meilisearch multi-search failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const body = (await res.json()) as { results?: MeiliAggregationResult[] };
  return body.results ?? [];
}

/**
 * Pure: the `q`/`filter`/`attributesToSearchOn` `fetchJobsLastUpdated` sends
 * for `p` — the exact same `buildFilter(p)` clauses, `quoteShortTokens(p.q)`
 * text, AND `resolveAttributesToSearchOn` scope the results search itself
 * uses, so the two queries agree on which rows match. `opts.companyScoped`
 * is REQUIRED, not defaulted — it's the one piece of that classification
 * that needs an async Meilisearch probe to resolve (`resolveCompanyIntent`),
 * so this pure function takes it as an already-resolved input rather than
 * guessing `false` when the caller forgot to await it (a wrong guess would
 * silently reintroduce the bug this fixes). `titleScoped` — the role-title
 * lane's membership — IS derivable synchronously from `p.q`/`companyScoped`
 * alone (`shouldRunRoleTitleLane`), so it's computed here rather than pushed
 * onto every caller. Split out so each narrowing shape (default 30d window,
 * no window, a single employer, a text query, a facet) is assertable without
 * a network call.
 */
export function buildLastUpdatedQuery(
  p: JobSearchParams,
  opts: { companyScoped: boolean },
): { q: string; filter: string[]; attributesToSearchOn?: string[] } {
  const titleScoped = shouldRunRoleTitleLane(p.q ?? "", opts.companyScoped);
  const attributesToSearchOn = resolveAttributesToSearchOn(p, { companyScoped: opts.companyScoped, titleScoped });
  return {
    q: quoteShortTokens(p.q ?? ""),
    filter: buildFilter(p),
    ...(attributesToSearchOn ? { attributesToSearchOn } : {}),
  };
}

/**
 * Read-path: MAX(`updated_at`) over the rows `p` would match (see
 * `buildLastUpdatedQuery`), so the "last synced" stamp describes the
 * population actually on screen rather than always the whole corpus. `p`
 * omitted (or `{}`) means "no narrowing" — the true corpus-wide stamp, still
 * scoped to live vacancies like every other search (`LIVE_VACANCY_FILTER` in
 * `buildFilter`). Resolves `companyScoped` via the SAME cached
 * `resolveCompanyIntentResult` `searchMeili` calls for the real results
 * search — not a second heuristic — before building the query, so the two
 * requests' `attributesToSearchOn` cannot diverge (intervu #484 review fix).
 * One extra Meilisearch round trip only on a cache miss (10-minute TTL,
 * keyed by query text); one search round trip: limit 1, sorted
 * `updated_at:desc`. A failed or unavailable probe returns `null` — the
 * caller (`searchResultLine`, presentation.ts) renders no clause rather than
 * guessing.
 */
export async function fetchJobsLastUpdated(p: JobSearchParams = {}): Promise<string | null> {
  const h = host();
  if (!h) return null;
  try {
    const { companyScoped } = await resolveCompanyIntentResult(p.id ? undefined : p.q);
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({
        ...buildLastUpdatedQuery(p, { companyScoped }),
        matchingStrategy: "all",
        limit: 1,
        sort: ["updated_at:desc"],
        attributesToRetrieve: ["updated_at"],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { hits?: { updated_at?: string }[] };
    return body.hits?.[0]?.updated_at ?? null;
  } catch {
    return null;
  }
}

/** Population floor for trusting `posted_ts` (fraction of `numberOfDocuments`
 * that carry the field). Config PRESENCE lies: the field can be declared in
 * `filterableAttributes` (see `JOBS_INDEX_SETTINGS`) and legally filterable
 * while 0 — or a token handful — of documents actually carry it, so a bare
 * `> 0` headcount check passes on a corpus where every real bucket still
 * 0-results. 0.5% is a coarse "meaningfully populated, not a rounding error"
 * bar, not a precision target. */
export const POSTED_TS_POPULATION_THRESHOLD = 0.005;

/**
 * Pure: does a `populated`/`total` split clear the population bar? Split out
 * from `fetchPostedDateFilterSupported` so the threshold logic is
 * unit-testable without a network call.
 */
export function isPostedTsPopulationSufficient(populated: number, total: number): boolean {
  if (total <= 0) return false;
  return populated > 0 && populated / total > POSTED_TS_POPULATION_THRESHOLD;
}

/**
 * Does the corpus actually carry `posted_ts` at a population that makes the
 * age-bucket filters meaningful? The buckets range-filter over that field, so
 * a corpus where it's unpopulated (or populated on a token few documents)
 * makes every bucket match nothing, or next to nothing — a control that
 * looks live but functions as an empty board.
 *
 * The field is declared filterable (see `JOBS_INDEX_SETTINGS`) but the sync
 * that writes documents lives outside this repo (`/opt/jobs-sync/sync.mjs`);
 * as of Jul 2026 population was 0%. This probes the data rather than
 * hard-coding that state: the moment the sync starts writing `posted_ts` at
 * real volume, the buckets light up again with no code change. Two
 * zero-cost (`limit: 0`) search-key-scoped counts — total corpus size and
 * `posted_ts`-populated size — rather than the Meilisearch `/stats` endpoint:
 * verified live (see `JOBS_INDEX_SETTINGS`'s `id` comment) that the
 * search-only key this module reads with 403s on non-search endpoints.
 *
 * Returns `null` when the probe itself fails (network/5xx/timeout): that is
 * "unknown", NOT "unsupported". The distinction is load-bearing — probe
 * failure correlates with box degradation, and answering "no" then made the
 * app DROP its default 30d posted filter and send match-all+facets browse
 * queries (the heaviest shape) exactly when Meilisearch was least able to
 * serve them (Jul 24 incident). Only a SUCCESSFUL probe that measures an
 * insufficient population answers `false` and hides the buckets.
 */
export async function fetchPostedDateFilterSupported(): Promise<boolean | null> {
  const h = host();
  if (!h) return false;
  const count = async (filter?: string): Promise<number> => {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(filter ? { limit: 0, filter } : { limit: 0 }),
    });
    if (!res.ok) throw new Error(`posted_ts population probe failed: ${res.status}`);
    const body = (await res.json()) as { totalHits?: number; estimatedTotalHits?: number };
    return body.totalHits ?? body.estimatedTotalHits ?? 0;
  };
  try {
    const [total, populated] = await Promise.all([count(), count("posted_ts >= 0")]);
    return isPostedTsPopulationSufficient(populated, total);
  } catch {
    return null;
  }
}

/**
 * Strips the German gender-neutral-suffix scrape artifact a colon-appended
 * convention leaves on a title copied verbatim from a German-language
 * source — live prod suggested "Product Manager:in"; "Entwickler:innen" is
 * the same artifact on an otherwise-German title. General rule (not a
 * per-title patch): a colon immediately followed by ONLY one of that closed
 * set of German suffixes, anchored to the end of the string — so any future
 * scrape from the same convention is caught by construction, not by adding
 * another literal to a blocklist. `$` anchors the match, so the alternation
 * order doesn't matter (the engine backtracks to "innen" if "in" alone
 * doesn't reach the end) — kept longest-first anyway for readability.
 */
export function stripGenderSuffixArtifact(text: string): string {
  return text.replace(/:(innen|in|r|e)$/i, "").trim();
}

/**
 * Pure: fold raw `{ title, company, company_domain }` hits into deduped,
 * capped suggestion lists. Extracted from `fetchJobSuggestions` so the
 * dedupe logic is unit-testable without a network call (see
 * tests/unit/jobs-suggestions.test.ts). Titles dedupe case-insensitively
 * (max 5) — first-seen casing wins, blank values are dropped. Both fields
 * run through `stripGenderSuffixArtifact` first — the scrape artifact can
 * land on either (title far more often, but nothing about the convention is
 * title-specific) — so a hit that's ONLY the artifact (blank once stripped)
 * is dropped exactly like any other blank value, not suggested as "".
 *
 * Companies get two extra passes titles don't need (2026-08-21 front-door
 * audit, item 6): a hit whose TITLE matched `q` says nothing about whether
 * its COMPANY is a relevant suggestion — live prod surfaced "Phsorg",
 * "Glance", and a raw ATS tenant string for a "product manager" query
 * purely because those hits' titles matched, not their companies. Only a
 * company whose OWN name relates to `q` (`titleMatchesQuery`, reused — the
 * rule is generic over what text it's applied to) is suggested, and a name
 * that's just its own domain with separators stripped
 * (`isDomainSquashName`) is repaired via `humanizeTenantSubdomain` before
 * that relevance check runs; a hit with no domain to confirm the squash
 * against falls straight through to the ordinary relevance check. Capped
 * at 2, not the titles' 5 — companies are a smaller,
 * higher-noise section of the dropdown.
 */
export function dedupeJobSuggestionHits(
  hits: Array<{ title?: string | null; company?: string | null; company_domain?: string | null }>,
  q: string,
): JobSuggestions {
  const titles: string[] = [];
  const seenTitles = new Set<string>();
  const companies: string[] = [];
  const seenCompanies = new Set<string>();

  for (const hit of hits) {
    const title = stripGenderSuffixArtifact((hit.title ?? "").trim());
    if (title) {
      const key = title.toLowerCase();
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        if (titles.length < 5) titles.push(title);
      }
    }
    let company = stripGenderSuffixArtifact((hit.company ?? "").trim());
    if (!company) continue;
    const domain = hit.company_domain ?? null;
    // `isDomainSquashName` needs the real domain to confirm the squash — it
    // returns false without one, so a company string with no domain on the
    // hit falls through to the ordinary relevance check below unrepaired
    // (nothing to compare it against, so nothing to safely repair or drop).
    if (domain && isDomainSquashName(company, domain)) {
      company = humanizeTenantSubdomain(domain);
    }
    // The index carries the ATS-stated raw name (intervu owns display-time
    // cleaning, not ingest — ingest is the pipeline repo's sync.mjs, which
    // PUTs the Subspace feed through unchanged), so fold junk prefixes / legal
    // suffixes / slogan-brand splits onto the same canonical form the SERP
    // renders RIGHT before the dedup key below — otherwise "REQ123 Acme",
    // "Acme, Inc.", and "We build things - Acme" dedupe as three distinct,
    // near-identical suggestion rows instead of collapsing into one "Acme".
    // `|| company` only matters if cleaning empties out an already-non-empty
    // string with no domain to fall back to (e.g. a bare legal-suffix token)
    // — keep showing the pre-clean text rather than drop the suggestion.
    company = displayCompanyBrand(company, domain, hit.title) || company;
    if (!titleMatchesQuery(company, q)) continue;
    const key = company.toLowerCase();
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key);
      if (companies.length < 2) companies.push(company);
    }
  }

  return { titles, companies };
}

const EMPTY_SUGGESTIONS: JobSuggestions = { titles: [], companies: [] };

export interface MeiliSuggestBody {
  q: string;
  limit: number;
  attributesToSearchOn: string[];
  attributesToRetrieve: string[];
  distinct?: string;
}

/**
 * Pure: the typeahead's search body. Extracted (same pure-decision/thin-I/O
 * split `buildSearchBody` above uses) so the shape is unit-testable without
 * a network call.
 *
 * `limit`, not `hitsPerPage` — `hitsPerPage` puts Meilisearch in its
 * page-mode pagination engine, which computes an EXACT total the typeahead
 * never reads; `limit` skips that exhaustive count. `attributesToSearchOn`
 * scopes matching to title+company so a query word buried three paragraphs
 * into a posting's description doesn't feed suggestions — description text
 * was never part of what a "suggestion" means here. Measured live against
 * the box 2026-08-14: the old `{ hitsPerPage, attributesToRetrieve }`-only
 * shape ran 0.62s cold / ~0.1s warm; this shape ran 0.15s cold / ~0.08s warm.
 *
 * `distinct: "title"` (2026-08-24) — measured live: a query matching a
 * common exact title (e.g. "manager", 100k hits) returned 100 hits ALL
 * titled "manager" before this, because the query's unit is documents, not
 * distinct titles. Legal only because `"title"` is in
 * `JOBS_INDEX_SETTINGS.filterableAttributes` above — see the invariant test
 * in jobs-suggestions.test.ts. This operates on the raw stored title, so
 * case variants still arrive as separate hits; `dedupeJobSuggestionHits`
 * still does the case-insensitive fold on top.
 */
export function buildSuggestBody(q: string): MeiliSuggestBody {
  return {
    q,
    limit: 20,
    attributesToSearchOn: ["title", "company"],
    // `company_domain` isn't matched against `q` (attributesToSearchOn above
    // stays title+company only) — retrieved so `dedupeJobSuggestionHits` can
    // tell a company name that's just its own domain squashed together from
    // a real one and repair or drop it instead of suggesting it verbatim.
    attributesToRetrieve: ["title", "company", "company_domain"],
    distinct: "title",
  };
}

/**
 * Read-path: title/company suggestions for the search box's typeahead
 * (Task 9). One search call against the live index — no facet request, no
 * counts (see `JobSuggestions` in types.ts). Never throws: an unreachable
 * index or a malformed response degrades to no suggestions, never an error
 * surfaced to the search box.
 */
export async function fetchJobSuggestions(q: string): Promise<JobSuggestions> {
  const query = q.trim();
  const h = host();
  if (!h || !query) return EMPTY_SUGGESTIONS;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(buildSuggestBody(query)),
    });
    if (!res.ok) return EMPTY_SUGGESTIONS;
    const body = (await res.json()) as {
      hits?: Array<{ title?: string; company?: string | null; company_domain?: string | null }>;
    };
    return dedupeJobSuggestionHits(body.hits ?? [], query);
  } catch {
    return EMPTY_SUGGESTIONS;
  }
}

/**
 * Read-path: does at least one corpus document's `company` field match every
 * word of `phrase`? Backs query-understanding.ts's S1 company-corroboration
 * guard (a gazetteer place match inside a multi-word free-text query can be
 * an employer name the corpus knows — "cleveland clinic" hijacked to
 * Cleveland the city, search-audit.md class 1). Restricted via
 * `attributesToSearchOn: ["company"]` — deliberately the ONE place this
 * module scopes a search to a single attribute; the general search body
 * never does (see jobs-search-body.test.ts) because THIS is a narrow
 * corroboration probe ("does the corpus know a company by this name"), not a
 * result page, and it never returns hits to render. `hitsPerPage: 1` because
 * the guard only needs a yes/no. Never throws — an unreachable index or
 * malformed response degrades to "not corroborated" (`false`), which lets
 * the place-strip this guard exists to second-guess proceed exactly as it
 * did before S1.
 */
export async function probeCompanyNames(phrase: string, sampleSize: number): Promise<CompanyNameSample> {
  const query = phrase.trim();
  const h = host();
  const empty: CompanyNameSample = { total: 0, companies: [], domains: [], titles: [] };
  if (!h || !query) return empty;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({
        q: query,
        matchingStrategy: "all",
        attributesToSearchOn: ["company"],
        filter: buildFilter({ q: query }),
        hitsPerPage: sampleSize,
        page: 1,
        attributesToRetrieve: ["company", "company_domain", "title"],
      }),
    });
    if (!res.ok) return empty;
    const body = (await res.json()) as {
      hits?: { company?: string | null; company_domain?: string | null; title?: string | null }[];
      totalHits?: number;
      estimatedTotalHits?: number;
    };
    const hits = body.hits ?? [];
    return {
      total: body.totalHits ?? body.estimatedTotalHits ?? hits.length,
      companies: hits.map((hit) => hit.company ?? ""),
      domains: hits.map((hit) => (hit.company_domain ?? "").trim().toLowerCase()),
      titles: hits.map((hit) => hit.title ?? ""),
    };
  } catch {
    return empty;
  }
}

export async function probeCompanyMatch(phrase: string): Promise<boolean> {
  return (await probeCompanyNames(phrase, 1)).total > 0;
}

/**
 * Memoized company-intent decision for a typed query — see company-intent.ts
 * for what the gate is and why it is a dominance ratio rather than
 * `probeCompanyMatch`'s boolean.
 *
 * Cached because this costs one extra Meilisearch round trip on the read
 * path, and the answer is a property of the CORPUS (does an employer carry
 * this name), not of the request: it is identical for every user typing the
 * same words, and changes only as slowly as the employer set does. The cache
 * is process-local and bounded; entries expire so a newly-indexed employer
 * becomes detectable without a redeploy. Failure degrades to `false`
 * (`probeCompanyNames` never throws), i.e. the normal whole-document search.
 */
const COMPANY_INTENT_TTL_MS = 10 * 60_000;
const COMPANY_INTENT_CACHE_MAX = 500;

export interface CompanyIntentResult {
  companyScoped: boolean;
  companyDomains: string[];
}

const companyIntentCache = new Map<string, { value: CompanyIntentResult; atMs: number }>();
// One probe per key at a time: a single search asks this from several
// places at once (main query, beyond-window and count probes), and before
// the first answer is cached each of them used to send its own identical
// probe — three at once on a cold query, roughly doubling its server time.
const companyIntentInFlight = new Map<string, Promise<CompanyIntentResult>>();

export function resetCompanyIntentCacheForTests(): void {
  companyIntentCache.clear();
  companyIntentInFlight.clear();
}

export async function resolveCompanyIntentResult(q: string | undefined): Promise<CompanyIntentResult> {
  const query = (q ?? "").trim();
  if (!query) return { companyScoped: false, companyDomains: [] };
  const key = normalizeCompanyName(query);
  const hit = companyIntentCache.get(key);
  if (hit && Date.now() - hit.atMs < COMPANY_INTENT_TTL_MS) return hit.value;

  const pending = companyIntentInFlight.get(key);
  if (pending) return pending;
  const probe = probeCompanyIntent(query, key).finally(() => companyIntentInFlight.delete(key));
  companyIntentInFlight.set(key, probe);
  return probe;
}

async function probeCompanyIntent(query: string, key: string): Promise<CompanyIntentResult> {
  const now = Date.now();
  const sample = await probeCompanyNames(query, COMPANY_INTENT_SAMPLE);
  const companyScoped = isCompanyNameQuery(query, sample);
  const value: CompanyIntentResult = {
    companyScoped,
    companyDomains: companyScoped ? dominantCompanyDomains(query, sample) : [],
  };
  if (companyIntentCache.size >= COMPANY_INTENT_CACHE_MAX) {
    const oldest = companyIntentCache.keys().next().value;
    if (oldest !== undefined) companyIntentCache.delete(oldest);
  }
  companyIntentCache.set(key, { value, atMs: now });
  return value;
}

export async function resolveCompanyIntent(q: string | undefined): Promise<boolean> {
  return (await resolveCompanyIntentResult(q)).companyScoped;
}

/**
 * Derive a sanitized, numeric "posted" timestamp (epoch ms) for a job. Meilisearch
 * range operators are numeric-only, so the raw ISO `posted_at` string can't be
 * used to range-filter directly — this is the numeric derivative, computed on
 * read by every consumer below (sort.ts, JobDetail, snapshot-preview.ts,
 * follows/alerts.ts) rather than stored on the index. The live jobs index is
 * written by the separate interview-os repo's scripts/jobs-sync/sync.mjs,
 * which derives its own `posted_ts` (public-job.ts's `derivePublicPostedTs`)
 * before PUTting documents — this is intervu's independent read-side copy of
 * that same derivation, not the ingest path.
 *
 * Measured live: `posted_at` is 18% null and carries future-dated sentinels
 * (2030-01-31, 2026-12-31) that sit at the head of a naive `posted_at:desc`
 * sort. `first_seen_at` is 0% null and 0% future, so it's the fallback.
 *
 * Sanitization (parses, on/after 2000-01-01, not more than 24h in the future)
 * is `sanitizeTimestamp` (./posting-freshness) — the ONE sanitizer shared with
 * the UI-side freshness/relist classification, so ingest-side and UI-side
 * reads always agree on what counts as a usable date.
 */
export function derivePostedTs(job: { posted_at?: string | null; first_seen_at?: string | null }): number | null {
  const now = Date.now();
  return sanitizeTimestamp(job.posted_at, now) ?? sanitizeTimestamp(job.first_seen_at, now) ?? null;
}
