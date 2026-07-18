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
import { buildMeiliSort } from "./sort";
import { FACETABLE_KEYS } from "./types";
import type { FacetDistribution, JobSearchParams, JobSearchResult, PublicJob } from "./types";

export const JOBS_INDEX = "jobs";

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
  ],
  sortableAttributes: ["posted_at", "first_seen_at", "updated_at", "salary_min", "salary_max", "posted_ts"],
  rankingRules: ["words", "typo", "proximity", "attribute", "sort", "exactness"],
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

function searchBody(p: JobSearchParams, legacy: boolean) {
  return {
    q: p.q ?? "",
    filter: buildFilter(p, legacy),
    facets: p.withFacets ? [...FACETABLE_KEYS] : undefined,
    // Page mode returns an EXACT totalHits; limit/offset mode caps the estimate at 1000.
    hitsPerPage: p.limit ?? 40,
    page: Math.floor((p.offset ?? 0) / (p.limit ?? 40)) + 1,
    sort: buildMeiliSort(p, legacy),
  };
}

/** Read-path: search the jobs index. */
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
  const post = (legacy: boolean) =>
    fetch(`${h}/indexes/${JOBS_INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
      cache: "no-store",
      body: JSON.stringify(searchBody(p, legacy)),
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

/** Sanity floor for `derivePostedTs` — anything before this is treated as junk. */
const POSTED_TS_FLOOR = Date.parse("2000-01-01T00:00:00Z");
/** Clock-skew / timezone grace before a timestamp counts as "in the future". */
const POSTED_TS_FUTURE_GRACE_MS = 24 * 60 * 60 * 1000;

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
 * A timestamp is accepted only if it parses, is on/after 2000-01-01, and is not
 * more than 24h in the future (small clock-skew grace, not a loophole for
 * sentinels months out).
 */
export function derivePostedTs(job: { posted_at?: string | null; first_seen_at?: string | null }): number | null {
  const now = Date.now();
  const sane = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    if (t < POSTED_TS_FLOOR) return null;
    if (t > now + POSTED_TS_FUTURE_GRACE_MS) return null;
    return t;
  };
  return sane(job.posted_at) ?? sane(job.first_seen_at) ?? null;
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
