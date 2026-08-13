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
import { sanitizeTimestamp } from "./posting-freshness";
import { buildMeiliSort } from "./sort";
import { FACETABLE_KEYS, REQUESTED_FACET_KEYS } from "./types";
import type { FacetDistribution, JobSearchParams, JobSearchResult, JobSuggestions, PlaceClause, PublicJob } from "./types";

export const JOBS_INDEX = "jobs";

/**
 * Curated query synonyms (spec §6.4). Conservative by design: only
 * unambiguous industry abbreviations. "pm" fans out to both of its common
 * meanings and lets ranking sort it out. Applied to the live index by
 * scripts/apply-synonyms.mjs (synonyms-only PUT — no reindex cost);
 * ⚠ the box-side sync worker holds its own settings copy, so a box
 * reprovision can wipe these — reconcile there when S1 ships (spec §9).
 */
export const JOBS_SYNONYMS: Record<string, string[]> = {
  swe: ["software engineer"],
  "software engineer": ["swe"],
  sre: ["site reliability engineer"],
  "site reliability engineer": ["sre"],
  pm: ["product manager", "project manager"],
  k8s: ["kubernetes"],
  kubernetes: ["k8s"],
  ml: ["machine learning"],
  "machine learning": ["ml"],
  ux: ["user experience"],
  qa: ["quality assurance"],
  hr: ["human resources"],
  devops: ["dev ops"],
};

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
  rankingRules: ["words", "sort", "typo", "proximity", "attributeRank", "wordPosition", "exactness", "posted_ts:desc"],
  synonyms: JOBS_SYNONYMS,
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
function renderPlaceClause(clause: PlaceClause): string {
  const any = "(" + clause.any.map((pl) => `${pl.field} = ${JSON.stringify(pl.value)}`).join(" OR ") + ")";
  if (!clause.scopedToCountry?.length) return any;
  const country = "(" + clause.scopedToCountry.map((pl) => `${pl.field} = ${JSON.stringify(pl.value)}`).join(" OR ") + ")";
  return `(${any} AND ${country})`;
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
    const vals = facets[key];
    if (!vals || vals.length === 0) continue;
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

export function buildSearchBody(
  p: JobSearchParams,
  legacy: boolean,
  matchingStrategy: MatchingStrategy = "all",
  opts?: BuildSearchBodyOpts,
): MeiliSearchBody {
  return {
    q: p.q ?? "",
    // Whole-document retrieval is the default and stays that way (see the
    // note above `searchMeili`). The ONE exception is a query the corpus
    // says is an employer's NAME: scoping it to `company` is what keeps
    // real listings at that employer above unrelated postings that merely
    // mention the word in a title ("FOREMAN - SEAL & STRIPE" for q=stripe).
    // That precision is currently a side effect of the `exactness` ranking
    // rule landing on the `company` attribute; doing it explicitly here is
    // what lets `exactness` be demoted to fix role queries without trading
    // one regression for another. See company-intent.ts.
    ...(opts?.companyScoped ? { attributesToSearchOn: ["company"] } : {}),
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
}

/** The three location fields a parsed place can constrain. */
export const LOCATION_FACET_FIELDS = ["location_city", "location_state", "location_country"] as const;

/**
 * Read-path: does a specific candidate STRING exist as a value in a given
 * location facet — the corpus validation layer behind gazetteer-backed place
 * resolution (lib/geo/corpus-values.ts). Meilisearch's facet-search endpoint
 * is typeahead-shaped (find values matching a query), which is exactly what
 * "does the corpus have this place" needs — unlike a bulk facet distribution
 * fetch (which only ever surfaces the top values by count), this reaches a
 * specific value regardless of how far down the long tail it sits. Measured
 * live against the box 2026-08-05: ~40ms per call.
 *
 * Returns null on ANY failure (no backend configured, network error,
 * non-2xx) — the caller (createCorpusValueChecker) treats that as "couldn't
 * ask" and fails the candidate open rather than caching a false negative.
 */
export async function fetchFacetSearch(
  field: (typeof LOCATION_FACET_FIELDS)[number],
  query: string,
): Promise<{ value: string; count: number }[] | null> {
  const h = host();
  if (!h) return null;
  try {
    const res = await meiliFetch(`${h}/indexes/${JOBS_INDEX}/facet-search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify({ facetName: field, facetQuery: query }),
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
 * Pure: fold raw `{ title, company }` hits into deduped, capped suggestion
 * lists. Extracted from `fetchJobSuggestions` so the dedupe logic is
 * unit-testable without a network call (see tests/unit/jobs-suggestions.test.ts).
 * Titles dedupe case-insensitively (max 5); companies dedupe case-insensitively
 * (max 3) — first-seen casing wins, blank values are dropped.
 */
export function dedupeJobSuggestionHits(
  hits: Array<{ title?: string | null; company?: string | null }>,
): JobSuggestions {
  const titles: string[] = [];
  const seenTitles = new Set<string>();
  const companies: string[] = [];
  const seenCompanies = new Set<string>();

  for (const hit of hits) {
    const title = (hit.title ?? "").trim();
    if (title) {
      const key = title.toLowerCase();
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        if (titles.length < 5) titles.push(title);
      }
    }
    const company = (hit.company ?? "").trim();
    if (company) {
      const key = company.toLowerCase();
      if (!seenCompanies.has(key)) {
        seenCompanies.add(key);
        if (companies.length < 3) companies.push(company);
      }
    }
  }

  return { titles, companies };
}

const EMPTY_SUGGESTIONS: JobSuggestions = { titles: [], companies: [] };

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
      body: JSON.stringify({ q: query, hitsPerPage: 20, attributesToRetrieve: ["title", "company"] }),
    });
    if (!res.ok) return EMPTY_SUGGESTIONS;
    const body = (await res.json()) as { hits?: Array<{ title?: string; company?: string | null }> };
    return dedupeJobSuggestionHits(body.hits ?? []);
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
