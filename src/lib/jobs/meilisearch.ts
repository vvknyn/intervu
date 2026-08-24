/**
 * Meilisearch backend for intervu jobs search (SERVER-ONLY, SDK-free).
 *
 * intervu owns its own search index; Subspace is the system of record. This
 * module talks to Meilisearch over its HTTP API via `fetch` (no SDK dependency
 * — keeps the engine swappable; "Meilisearch vs Typesense" is an open decision
 * in docs/intervu-jobs-api.md). Read-path search uses the search-only key;
 * ingestion/admin uses the admin key and is only ever invoked by the off-Vercel
 * sync worker — never at request time.
 */
import { getBoardDomains } from "@/lib/boards/allowlists";
import {
  COMPANY_INTENT_SAMPLE,
  isCompanyNameQuery,
  normalizeCompanyName,
  type CompanyNameSample,
} from "./company-intent";
import { isTechSkillQuery } from "./tech-skills";
import { decodeText, humanizeTenantSubdomain, isDomainSquashName, titleMatchesQuery } from "./presentation";
import { sanitizeTimestamp } from "./posting-freshness";
import { buildMeiliSort, compareJobsBySort, isPageSorted, resolveEffectiveSort, shouldScopeTextMatchToTitle, sortVerifiableHits } from "./sort";
import { FACETABLE_KEYS, REQUESTED_FACET_KEYS } from "./types";
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
  searchableAttributes: ["title", "company", "description", "location", "tags"],
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
    // faithful mirror of the live index: applyIndexSettings's PATCH replaces
    // filterableAttributes wholesale, so omitting a live-only entry here
    // would silently DROP it on the next apply. Do not remove without
    // confirming the box no longer needs it.
    "occupation",
  ],
  sortableAttributes: ["posted_at", "first_seen_at", "updated_at", "salary_min", "salary_max", "posted_ts"],
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
  // catch (see `sortVerifiableHits`, sort.ts, and `applySortIntegrityGuard`
  // below, updated the same day to check only the 0-typo/titled subsequence
  // rather than the whole page).
  //
  // BEST is byte-identical: BEST sends no `sort` param, so the `sort` rule is
  // inert regardless of where it sits, and moving it past `typo` does not
  // change the RELATIVE order of any other rule — words, typo, proximity,
  // attributeRank, wordPosition, exactness, posted_ts:desc, exactly as
  // before once the inert `sort` rule is excluded. Only an explicit
  // (non-relevance) sort is affected.
  rankingRules: ["words", "typo", "sort", "proximity", "attributeRank", "wordPosition", "exactness", "posted_ts:desc"],
  synonyms: JOBS_SYNONYMS,
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

function adminKey(): string {
  return process.env.MEILISEARCH_ADMIN_KEY || process.env.MEILISEARCH_API_KEY || "";
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
 * path: the ingestion/admin functions below (off-Vercel sync worker, admin
 * key, bulk PUT/DELETE) run on their own schedule outside any Vercel
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
}

/** TRANSITIONAL: live index may lack `company_domain` in filterableAttributes. */
let companyDomainFilterUnsupported = false;

export function resetCompanyDomainFilterSupportForTests(): void {
  companyDomainFilterUnsupported = false;
}

function needsDomainFilters(p: JobSearchParams): boolean {
  return Boolean(p.board || p.companyDomain);
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
  p: Pick<JobSearchParams, "board" | "companyDomain">,
): boolean {
  if (p.board) {
    const domains = getBoardDomains(p.board);
    if (domains.length > 0 && !domains.includes((j.company_domain ?? "").toLowerCase())) return false;
  }
  if (p.companyDomain) {
    if ((j.company_domain ?? "").toLowerCase() !== p.companyDomain.trim().toLowerCase()) return false;
  }
  return true;
}

export function filterHitsByDomainFilters(
  hits: PublicJob[],
  p: Pick<JobSearchParams, "board" | "companyDomain">,
): PublicJob[] {
  if (!needsDomainFilters(p)) return hits;
  return hits.filter((j) => jobMatchesDomainFilters(j, p));
}

/** Pure: one `PlaceClause` -> its Meilisearch boolean sub-expression — the
 *  `any` OR-group alone, or ANDed against `scopedToCountry` when present
 *  (see `PlaceClause`'s doc, jobs/types.ts, for why only a city/metro
 *  mention ever carries that second group). */
export function renderPlaceClause(clause: PlaceClause): string {
  const parts = ["(" + clause.any.map((pl) => `${pl.field} = ${JSON.stringify(pl.value)}`).join(" OR ") + ")"];
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
    const vals = rawVals.filter((v) => v !== "any" && v !== "all");
    if (vals.length === 0) continue;
    // OR within a facet, AND across facets. JSON.stringify quotes + escapes the value.
    f.push("(" + vals.map((v) => `${key} = ${JSON.stringify(v)}`).join(" OR ") + ")");
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
      f.push(`posted_ts < ${now - BUCKET_MS["30d"]}`);
    } else {
      f.push(`posted_ts >= ${now - BUCKET_MS[p.postedBucket]}`);
    }
    // Docs with a null posted_ts (not yet backfilled) simply won't match — acceptable.
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
    if (p.companyDomain) {
      f.push(`company_domain = ${JSON.stringify(p.companyDomain.trim().toLowerCase())}`);
    }
  }
  return f;
}

/** Pure relax policy: fall back to word-dropping only when a real query
 *  strictly matched NOTHING. Never on merely-thin results — a query with 3
 *  genuine all-word matches shows those 3, not 3 plus word-dropped noise. */
export function shouldRelaxSearch(strictTotal: number, q: string): boolean {
  return Boolean(q.trim()) && strictTotal === 0;
}

/** Explicit shape so call sites and tests can touch optional fields under tsc. */
/**
 * "all" requires every query word to match; "last" is Meilisearch's default,
 * which drops words from the end until something matches. We search strictly
 * and relax deliberately — never the other way round.
 */
export type MatchingStrategy = "all" | "last";

export interface MeiliSearchBody {
  q: string;
  matchingStrategy: MatchingStrategy;
  filter: string[];
  facets?: string[];
  hitsPerPage: number;
  page: number;
  sort?: string[];
  attributesToSearchOn?: string[];
}

/**
 * `minWordSizeForTypos.oneTypo` — read from `JOBS_INDEX_SETTINGS.typoTolerance`
 * (declared above) rather than a live GET against
 * `/indexes/jobs/settings/typo-tolerance`. That endpoint needs the admin
 * key, which per this file's module docblock is available ONLY to the
 * off-Vercel sync worker (`sync.ts`) and is never present in a Vercel
 * request; the search-only key this read path actually holds 403s on every
 * settings endpoint (verified live 2026-08-23 — the same constraint
 * `fetchPostedDateFilterSupported` above already documents and works around
 * for `/stats`). A request-time GET here would 403 on every request in
 * production and permanently take the fail-safe branch below, so it would
 * ship as dead code that silently never fixes the bug it exists for.
 * Sourcing from the settings object the sync worker already applies to the
 * live index keeps one canonical number: retune typo tolerance by editing
 * `JOBS_INDEX_SETTINGS.typoTolerance` and both the live index (next
 * `applyIndexSettings`) and query-building below follow automatically.
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

export function buildSearchBody(
  p: JobSearchParams,
  legacy: boolean,
  matchingStrategy: MatchingStrategy = "all",
  opts?: BuildSearchBodyOpts,
): MeiliSearchBody {
  // `matchingStrategy === "last"` is this file's existing marker for "this is
  // the relaxed pass" (see `searchMeili`'s `runPass`/`shouldRelaxSearch`) —
  // fired only after a strict scoped pass came back with zero hits. Reusing
  // it here means the relax pass drops title/company scoping back to
  // whole-document search by construction, with no second rebuild path: a
  // genuinely-empty result still degrades gracefully instead of staying
  // artificially empty under a scope that just proved it matches nothing.
  const sortScoped =
    matchingStrategy !== "last" && shouldScopeTextMatchToTitle(resolveEffectiveSort(p), p.q);
  const techSkillScoped =
    !opts?.companyScoped && !sortScoped && matchingStrategy !== "last" && isTechSkillQuery(p.q ?? "");
  return {
    // `quoteShortTokens` only rewrites the text handed to Meilisearch — every
    // classifier below (`sortScoped`, `techSkillScoped`, `buildFilter`, …)
    // still reads the raw `p.q`/`p` so quoting can never change what the
    // query is CLASSIFIED as, only how its short tokens are matched.
    q: quoteShortTokens(p.q ?? ""),
    // Whole-document retrieval is the default and stays that way (see the
    // note above `searchMeili`). Two scoped exceptions, company-intent always
    // narrower and therefore always winning when both apply:
    //  - `companyScoped`: the query text names an employer — see the
    //    "FOREMAN - SEAL & STRIPE" note in company-intent.ts. Restricts to
    //    `company` alone.
    //  - `sortScoped`: an explicit non-relevance sort turns `sort` into a
    //    real ORDER BY (JOBS_INDEX_SETTINGS's rankingRules docblock above) —
    //    restricts to `title`+`company` so a fresh/high-salary posting that
    //    only matches in its description can't outrank real title matches
    //    under that ordering. See `shouldScopeTextMatchToTitle` (sort.ts).
    //  - `techSkillScoped`: standalone tech/programming language tokens
    //    (e.g. "Rust", "Swift", "Python") scope to title/tags/description
    //    to prevent non-tech company false positives (e.g. "Rust Medical Center").
    ...(opts?.companyScoped
      ? { attributesToSearchOn: ["company"] }
      : sortScoped
        ? { attributesToSearchOn: ["title", "company"] }
        : techSkillScoped
          ? { attributesToSearchOn: ["title", "tags", "description"] }
          : {}),
    // Meilisearch's DEFAULT is "last", which drops query words from the end
    // until something matches. For a three-word role that means a search for
    // "Technical Account Manager" is allowed to answer with documents that
    // only matched "Technical" — observed live: Maintenance Technician and
    // Laboratory Technician rows filling a Technical-Account-Manager search.
    // Requiring every word is the honest default; `searchMeili` relaxes to
    // "last" only after strict matching has genuinely found nothing.
    matchingStrategy,
    filter: buildFilter(p, legacy, opts),
    facets: p.withFacets ? [...REQUESTED_FACET_KEYS] : undefined,
    // Page mode returns an EXACT totalHits; limit/offset mode caps the estimate at 1000.
    hitsPerPage: p.limit ?? 40,
    page: Math.floor((p.offset ?? 0) / (p.limit ?? 40)) + 1,
    sort: buildMeiliSort(p, legacy),
  };
}

const POST_FILTER_PAGE_SIZE = 500;
const POST_FILTER_SCAN_CAP = 10_000;
const DOMAIN_POSTFILTER_NOTE =
  "Company domain filter applied locally — index filterableAttributes update pending";

/** TRANSITIONAL: scan Meili without domain filters and match in-app. */
async function searchWithDomainPostFilter(
  h: string,
  p: JobSearchParams,
  matchingStrategy: MatchingStrategy,
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
    const body = {
      ...buildSearchBody(scanParams, legacy, matchingStrategy, { skipDomainFilters: true }),
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
    const hits = parsed.hits ?? [];
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
 *  One pass over the WHOLE document — every query word must match, but it may
 *  match anywhere in `searchableAttributes` (title, company, description,
 *  location, tags — `JOBS_INDEX_SETTINGS`). The old title/company precision
 *  pass treated place words as title words: "product manager canada" found
 *  only the 24 roles literally TITLED that, while 23,813 postings matched all
 *  three words somewhere (measured live 2026-07-26). Attribute order in
 *  `searchableAttributes` still ranks title matches first, so precision at
 *  the top survives without the restriction — verified: identical top-3 on
 *  every keyword query probed.
 *
 *  One pass, not two, is also the latency posture the 2026-07-24 incident
 *  bought: no sequential second request to blow the settle guard under load.
 *  Only a strict ZERO relaxes to Meilisearch's word-dropping "last" — flagged
 *  `widened` so the UI can disclose partial matches. */
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
 * there is no engine-decided order to verify.
 *
 * 2026-08-14: checks `sortVerifiableHits(hits, mode, p.q)`, not `hits`
 * directly. `typo` now sits ahead of `sort` in `rankingRules`
 * (`JOBS_INDEX_SETTINGS` docblock above), so a scoped sorted page can
 * legitimately restart its date/salary order at a typo-bucket boundary —
 * that restart is the new rule order working as intended, not the
 * searchCutoffMs partial-sort disorder this guard exists to catch, so
 * checking the WHOLE page would retry (and locally re-sort, undoing the
 * bucketing) on every such page. `sortVerifiableHits` narrows the check to
 * the titled subsequence — the 0-typo bucket's visible face, and the only
 * part of the page this guard can hold to a real monotonic promise; below
 * that seam carries no such promise ("weaker matches") and was never this
 * guard's to order. See `sortVerifiableHits`'s own docblock (sort.ts) for
 * why this is safe to ship ahead of the rankingRules change landing on the
 * live index. Unscoped requests (empty `q`, or relevance) are unaffected —
 * they still get the original whole-page check.
 */
async function applySortIntegrityGuard(
  result: JobSearchResult,
  p: JobSearchParams,
  runSearch: () => Promise<JobSearchResult>,
): Promise<JobSearchResult> {
  const mode = resolveEffectiveSort(p);
  if (mode === "relevance") return result;
  const verifiable = (hits: PublicJob[]) => sortVerifiableHits(hits, mode, p.q);
  if (isPageSorted(verifiable(result.hits), mode)) return result;

  const retry = await runSearch();
  if (isPageSorted(verifiable(retry.hits), mode)) return retry;

  console.warn("[jobs-search] sort-integrity: engine returned unsorted page, re-sorted locally", {
    q: p.q,
    mode,
  });
  return { ...retry, hits: [...retry.hits].sort((a, b) => compareJobsBySort(a, b, mode)) };
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

  const runSearch = async (): Promise<JobSearchResult> => {
    const needsDomain = needsDomainFilters(p);

    const runDomainPostFilter = (matchingStrategy: MatchingStrategy = "all") =>
      searchWithDomainPostFilter(h, p, matchingStrategy);

    if (companyDomainFilterUnsupported && needsDomain) {
      const strict = await runDomainPostFilter();
      if (!shouldRelaxSearch(strict.total, p.q ?? "")) return strict;
      const relaxed = await runDomainPostFilter("last");
      return relaxed.total > 0 ? { ...relaxed, widened: true } : strict;
    }

    // One extra round trip, memoized per query across requests
    // (`resolveCompanyIntent`), and only for free-text queries: an id probe,
    // a plain browse or a board/domain browse never asks. The domain
    // post-filter path above is deliberately excluded — those are
    // `board`/`companyDomain` browses that are ALREADY constrained to one
    // employer, so company-scoping the query text would add nothing.
    const companyScoped = await resolveCompanyIntent(p.id ? undefined : p.q);

    const runPass = async (
      matchingStrategy: MatchingStrategy = "all",
    ): Promise<JobSearchResult> => {
      const post = (legacy: boolean) =>
        meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
          cache: "no-store",
          body: JSON.stringify(buildSearchBody(p, legacy, matchingStrategy, { companyScoped })),
        });

      let res = await post(false);
      if (!res.ok && res.status === 400) {
        const text = await res.text().catch(() => "");
        // TRANSITIONAL: posted_ts isn't sortable/filterable on the live index yet
        // (the settings PATCH + reindex run on the sync box, separately from this
        // deploy). Retry once without it instead of 400ing every search. Safe to
        // delete this branch once that reindex has landed.
        if (/posted_ts/i.test(text)) {
          console.warn("posted_ts not yet indexed — falling back to legacy sort/filter");
          res = await post(true);
        } else if (/company_domain/i.test(text) && needsDomain) {
          companyDomainFilterUnsupported = true;
          console.warn("company_domain not yet filterable — falling back to local post-filter");
          return runDomainPostFilter(matchingStrategy);
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
      };
      return {
        hits: body.hits ?? [],
        total: body.totalHits ?? body.estimatedTotalHits ?? body.hits?.length ?? 0,
        backend: "meilisearch",
        configured: true,
        facetDistribution: body.facetDistribution as FacetDistribution | undefined,
      };
    };

    const strict = await runPass();
    if (!shouldRelaxSearch(strict.total, p.q ?? "")) return strict;

    // Every word matched nothing anywhere — only now drop back to
    // Meilisearch's word-dropping default, so a long or unusual query still
    // returns its best partial matches instead of an empty screen. Reaching
    // here means strict matching already came back empty, so this can only add
    // results, never displace better ones. Flagged `widened` because partial
    // matches are exactly what that flag exists to disclose.
    const relaxed = await runPass("last");
    return relaxed.total > 0 ? { ...relaxed, widened: true } : strict;
  };

  const result = await runSearch();
  if (resolveEffectiveSort(p) === "relevance" && result.hits.length > 0) {
    result.hits = applyRelevanceQualityReranking(result.hits, p.q);
  }
  return applySortIntegrityGuard(result, p, runSearch);
}

const NON_TECH_ROLE_REGEX = /\b(therapist|nurse|nursing|physician|dental|dentist|driver|paramedic|phlebotomist|teacher|substitute teacher|caregiver|cook|waiter|bus monitor|janitor|custodian)\b/i;

/**
 * Post-search relevance & quality reranking for default/relevance searches:
 * Subtly elevates high-signal postings that candidates prioritize:
 * 0. Demotes non-tech titles on tech queries (e.g. "Therapist at Rust Medical Center" when searching "Rust").
 * 1. Exact title alignment with search query.
 * 2. Transparent compensation disclosure (salary_min > 0 or salary_max > 0).
 * 3. Verified clear ghost badge (ghost_badge === "clear").
 * 4. Recency tie-breaker.
 */
export function applyRelevanceQualityReranking(hits: PublicJob[], q?: string): PublicJob[] {
  if (!hits || hits.length <= 1) return hits;
  const query = (q ?? "").trim().toLowerCase();
  const isTech = isTechSkillQuery(query);

  return [...hits].sort((a, b) => {
    // 0. Non-tech role demotion for tech queries
    if (isTech) {
      const aIsNonTech = NON_TECH_ROLE_REGEX.test(decodeText(a.title)) ? 1 : 0;
      const bIsNonTech = NON_TECH_ROLE_REGEX.test(decodeText(b.title)) ? 1 : 0;
      if (aIsNonTech !== bIsNonTech) return aIsNonTech - bIsNonTech;
    }

    // 1. Exact title match tier
    const aTitleMatch = query && titleMatchesQuery(decodeText(a.title), query) ? 1 : 0;
    const bTitleMatch = query && titleMatchesQuery(decodeText(b.title), query) ? 1 : 0;
    if (aTitleMatch !== bTitleMatch) return bTitleMatch - aTitleMatch;

    // 2. Salary disclosure boost (disclosed pay is high signal for job seekers)
    const aHasSalary = (a.salary_min != null && a.salary_min > 0) || (a.salary_max != null && a.salary_max > 0) ? 1 : 0;
    const bHasSalary = (b.salary_min != null && b.salary_min > 0) || (b.salary_max != null && b.salary_max > 0) ? 1 : 0;
    if (aHasSalary !== bHasSalary) return bHasSalary - aHasSalary;

    // 3. Ghost status tiering (clear > unscored/caution > likely_ghost)
    const ghostScore = (g: string) => (g === "clear" ? 2 : g === "likely_ghost" ? 0 : 1);
    const aGhost = ghostScore(a.ghost_badge);
    const bGhost = ghostScore(b.ghost_badge);
    if (aGhost !== bGhost) return bGhost - aGhost;

    // 4. Recency tie-break (posted_ts)
    return (b.posted_ts ?? 0) - (a.posted_ts ?? 0);
  });
}

/** The three location fields a parsed place can constrain. */
export const LOCATION_FACET_FIELDS = ["location_city", "location_state", "location_country"] as const;

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
  /** Narrows the counts, e.g. `work_type = "remote"`. Meili applies it to the
   *  facet search itself, so the number returned is the true intersection
   *  rather than the facet value's total — which is what lets the location
   *  picker show a work-mode-qualified count it can actually deliver. */
  filter?: string,
): Promise<{ value: string; count: number }[] | null> {
  const h = host();
  if (!h) return null;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/facet-search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({ facetName: field, facetQuery: query, ...(filter ? { filter } : {}) }),
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

/** Read-path: the `updated_at` of the most recently updated doc, for the "last synced" stamp. */
export async function fetchJobsLastUpdated(): Promise<string | null> {
  const h = host();
  if (!h) return null;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({ limit: 1, sort: ["updated_at:desc"], attributesToRetrieve: ["updated_at"] }),
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
  const empty: CompanyNameSample = { total: 0, companies: [] };
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
        attributesToRetrieve: ["company"],
      }),
    });
    if (!res.ok) return empty;
    const body = (await res.json()) as {
      hits?: { company?: string | null }[];
      totalHits?: number;
      estimatedTotalHits?: number;
    };
    const hits = body.hits ?? [];
    return {
      total: body.totalHits ?? body.estimatedTotalHits ?? hits.length,
      companies: hits.map((hit) => hit.company ?? ""),
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
const companyIntentCache = new Map<string, { value: boolean; atMs: number }>();

export function resetCompanyIntentCacheForTests(): void {
  companyIntentCache.clear();
}

export async function resolveCompanyIntent(q: string | undefined): Promise<boolean> {
  const query = (q ?? "").trim();
  if (!query) return false;
  const key = normalizeCompanyName(query);
  const hit = companyIntentCache.get(key);
  const now = Date.now();
  if (hit && now - hit.atMs < COMPANY_INTENT_TTL_MS) return hit.value;

  const sample = await probeCompanyNames(query, COMPANY_INTENT_SAMPLE);
  const value = isCompanyNameQuery(query, sample);
  if (companyIntentCache.size >= COMPANY_INTENT_CACHE_MAX) {
    const oldest = companyIntentCache.keys().next().value;
    if (oldest !== undefined) companyIntentCache.delete(oldest);
  }
  companyIntentCache.set(key, { value, atMs: now });
  return value;
}

/* --------- Ingestion / admin (invoked only by the off-Vercel sync worker) --------- */

async function adminFetch(path: string, init: RequestInit): Promise<unknown> {
  const h = host();
  if (!h) throw new Error("MEILISEARCH_HOST not set");
  const res = await fetch(`${h}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminKey()}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Meilisearch ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function applyIndexSettings(): Promise<void> {
  await adminFetch(`/indexes/${JOBS_INDEX}/settings`, {
    method: "PATCH",
    body: JSON.stringify(JOBS_INDEX_SETTINGS),
  });
}

/**
 * Derive a sanitized, numeric "posted" timestamp (epoch ms) for a job. Meilisearch
 * range operators are numeric-only, so the raw ISO `posted_at` string can't be
 * used to range-filter directly — this is the numeric derivative, computed once
 * at the ingest chokepoint (`upsertJobs`) rather than at query time.
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

export async function upsertJobs(jobs: PublicJob[]): Promise<void> {
  if (!jobs.length) return;
  // Chokepoint: every ingest path (initialLoad / syncChanged / reconcileAndEvict
  // in lib/jobs/sync.ts) funnels through here, so deriving posted_ts once at the
  // PUT boundary keeps it consistent without threading it through each caller.
  const docs = jobs.map((j) => ({ ...j, posted_ts: derivePostedTs(j) }));
  await adminFetch(`/indexes/${JOBS_INDEX}/documents?primaryKey=id`, {
    method: "PUT",
    body: JSON.stringify(docs),
  });
}

export async function deleteJobs(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await adminFetch(`/indexes/${JOBS_INDEX}/documents/delete-batch`, {
    method: "POST",
    body: JSON.stringify(ids),
  });
}

/** All indexed job ids (for reconciliation / eviction). */
export async function allIndexedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const body = (await adminFetch(
      `/indexes/${JOBS_INDEX}/documents?fields=id&limit=${limit}&offset=${offset}`,
      { method: "GET" },
    )) as { results?: { id: string }[] };
    const results = body.results ?? [];
    for (const r of results) ids.add(r.id);
    if (results.length < limit) break;
    offset += limit;
  }
  return ids;
}
