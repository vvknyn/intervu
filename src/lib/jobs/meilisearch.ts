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
import { sanitizeTimestamp } from "./posting-freshness";
import { buildMeiliSort } from "./sort";
import { FACETABLE_KEYS } from "./types";
import type { FacetDistribution, JobSearchParams, JobSearchResult, JobSuggestions, PublicJob } from "./types";

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
  rankingRules: ["words", "typo", "proximity", "attributeRank", "sort", "wordPosition", "exactness", "posted_ts:desc"],
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

function host(): string | null {
  const h = process.env.MEILISEARCH_HOST;
  return h ? h.replace(/\/+$/, "") : null;
}

export function hasMeilisearch(): boolean {
  return Boolean(host());
}

function searchKey(): string {
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
async function meiliFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await meiliFetchOnce(url, init);
    if (res.ok || !isRetryableMeiliFailure(res.status)) return res;
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

/**
 * `legacy=true` drops anything that depends on `posted_ts` — the TRANSITIONAL
 * fallback used when the live index doesn't have the field yet (see
 * `searchMeili`'s 400-retry). Remove the `legacy` param once the reindex lands.
 */
export function buildFilter(p: JobSearchParams, legacy = false): string[] {
  const f: string[] = ['vacancy_status != "closed"'];
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
): MeiliSearchBody {
  return {
    q: p.q ?? "",
    // Meilisearch's DEFAULT is "last", which drops query words from the end
    // until something matches. For a three-word role that means a search for
    // "Technical Account Manager" is allowed to answer with documents that
    // only matched "Technical" — observed live: Maintenance Technician and
    // Laboratory Technician rows filling a Technical-Account-Manager search.
    // Requiring every word is the honest default; `searchMeili` relaxes to
    // "last" only after strict matching has genuinely found nothing.
    matchingStrategy,
    filter: buildFilter(p, legacy),
    facets: p.withFacets ? [...FACETABLE_KEYS] : undefined,
    // Page mode returns an EXACT totalHits; limit/offset mode caps the estimate at 1000.
    hitsPerPage: p.limit ?? 40,
    page: Math.floor((p.offset ?? 0) / (p.limit ?? 40)) + 1,
    sort: buildMeiliSort(p, legacy),
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

  const runPass = async (
    matchingStrategy: MatchingStrategy = "all",
  ): Promise<JobSearchResult> => {
    const post = (legacy: boolean) =>
      meiliFetch(`${h}/indexes/${JOBS_INDEX}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        cache: "no-store",
        body: JSON.stringify(buildSearchBody(p, legacy, matchingStrategy)),
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
