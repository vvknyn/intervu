/**
 * Snapshot-preview jobs backend (DEV / DEMO ONLY — not production search).
 *
 * When Meilisearch isn't reachable yet but a `SUBSPACE_API_KEY` exists, this
 * lets /jobs show REAL jobs by pulling a capped slice of `/jobs/snapshot` into
 * module memory and filtering + faceting in JS. It is NOT the full corpus and
 * NOT scalable — it exists so the search + filter UI can be exercised against
 * real data before the index stands up. Enable with `JOBS_PREVIEW_FROM_SNAPSHOT=1`.
 *
 * Faceting is disjunctive (a facet's own selection does not collapse its other
 * options' counts), matching how a faceted filter UI is expected to behave.
 */
import { hasSubspaceApiKey, iterateSnapshot } from "./subspaceJobs";
import { FACETABLE_KEYS } from "./types";
import type { FacetDistribution, FacetKey, JobSearchParams, JobSearchResult, PublicJob } from "./types";

const MAX_PAGES = 6; // ≤ 6 × 500 = 3000 jobs held in memory
const PAGE_LIMIT = 500;
const TTL_MS = 10 * 60 * 1000;

let cache: { jobs: PublicJob[]; at: number } | null = null;
let inflight: Promise<PublicJob[]> | null = null;

export function previewEnabled(): boolean {
  return process.env.JOBS_PREVIEW_FROM_SNAPSHOT === "1" && hasSubspaceApiKey();
}

async function loadCorpus(): Promise<PublicJob[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.jobs;
  if (inflight) return inflight;
  inflight = (async () => {
    const jobs: PublicJob[] = [];
    for await (const page of iterateSnapshot({ limit: PAGE_LIMIT, maxPages: MAX_PAGES })) {
      jobs.push(...page);
    }
    cache = { jobs, at: Date.now() };
    inflight = null;
    return jobs;
  })();
  return inflight;
}

function facetValue(j: PublicJob, key: FacetKey): string | null {
  const v = (j as unknown as Record<string, unknown>)[key];
  return v == null || v === "" ? null : String(v);
}

function jobTopSalary(j: PublicJob): number | null {
  return j.salary_max ?? j.salary_min ?? null;
}

/** Query + salary + visa predicates (the non-facet filters), always applied. */
function passBase(j: PublicJob, p: JobSearchParams): boolean {
  if (p.q) {
    const hay = `${j.title} ${j.company ?? ""} ${j.location ?? ""} ${(j.tags ?? []).join(" ")}`.toLowerCase();
    if (!hay.includes(p.q.toLowerCase())) return false;
  }
  if (p.salaryMin && p.salaryMin > 0) {
    const s = jobTopSalary(j);
    if (s == null || s < p.salaryMin) return false;
  }
  if (p.visaOnly && j.visa_sponsorship !== true) return false;
  return true;
}

function passFacet(j: PublicJob, key: FacetKey, vals: string[] | undefined): boolean {
  if (!vals || vals.length === 0) return true;
  const v = facetValue(j, key);
  return v != null && vals.includes(v);
}

/** All facet predicates except `exceptKey` (for disjunctive facet counting). */
function passFacets(j: PublicJob, p: JobSearchParams, exceptKey?: FacetKey): boolean {
  const facets = p.facets ?? {};
  for (const key of FACETABLE_KEYS) {
    if (key === exceptKey) continue;
    if (!passFacet(j, key, facets[key])) return false;
  }
  return true;
}

function postedTime(j: PublicJob): number {
  const t = j.posted_at || j.first_seen_at;
  const n = t ? Date.parse(t) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function computeFacetDistribution(corpus: PublicJob[], p: JobSearchParams): FacetDistribution {
  const dist: FacetDistribution = {};
  for (const key of FACETABLE_KEYS) {
    const counts: Record<string, number> = {};
    for (const j of corpus) {
      if (!passBase(j, p)) continue;
      if (!passFacets(j, p, key)) continue; // every facet except this one
      const v = facetValue(j, key);
      if (v == null) continue;
      counts[v] = (counts[v] ?? 0) + 1;
    }
    dist[key] = counts;
  }
  return dist;
}

export async function searchSnapshotPreview(p: JobSearchParams): Promise<JobSearchResult> {
  const corpus = await loadCorpus();
  const filtered = corpus
    .filter((j) => passBase(j, p) && passFacets(j, p))
    .sort((a, b) => postedTime(b) - postedTime(a));
  const offset = p.offset ?? 0;
  const limit = p.limit ?? 40;
  return {
    hits: filtered.slice(offset, offset + limit),
    total: filtered.length,
    backend: "snapshot-preview",
    configured: true,
    preview: true,
    facetDistribution: p.withFacets ? computeFacetDistribution(corpus, p) : undefined,
    note:
      `Preview mode: searching the first ${corpus.length.toLocaleString()} active jobs ` +
      `(not the full corpus). Stand up the search index for complete results.`,
  };
}
