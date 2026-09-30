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
import { getBoardDomains } from "@/lib/boards/allowlists";
import type { BoardId } from "@/lib/boards/types";
import { resolveFitPhrases } from "./fit-phrases";
import { derivePostedTs } from "./meilisearch";
import { compareJobsBySort, resolveEffectiveSort } from "./sort";
import { hasSubspaceApiKey, iterateSnapshot } from "./subspaceJobs";
import { FACETABLE_KEYS } from "./types";
import { facetValueMatches } from "./unknown-inclusive-facets";
import type { FacetDistribution, FacetKey, JobSearchParams, JobSearchResult, PostedBucket, PublicJob } from "./types";

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

/** Age-bucket → milliseconds lookback. Mirrors lib/jobs/meilisearch.ts's BUCKET_MS. */
const BUCKET_MS: Record<Exclude<PostedBucket, "older">, number> = {
  "1d": 1 * 86_400_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

/** True if `j`'s sanitized posted_ts falls in `bucket`. Jobs with no derivable ts never match. */
function passPostedBucket(j: PublicJob, bucket: PostedBucket | undefined): boolean {
  if (!bucket) return true;
  const ts = derivePostedTs(j);
  if (ts == null) return false;
  const now = Date.now();
  return bucket === "older" ? ts < now - BUCKET_MS["90d"] : ts >= now - BUCKET_MS[bucket];
}

/** Query + salary + visa + posted-bucket predicates (the non-facet filters), always applied. */
function passBase(j: PublicJob, p: JobSearchParams): boolean {
  // Task 11 — existence check (see JobSearchParams.id): an ADDITIONAL AND'd
  // clause, mirroring meilisearch.ts's `id = ...` filter push — not an
  // early return, so this stays correct if a future caller ever combines
  // `id` with other predicates instead of sending it alone.
  if (p.id && j.id !== p.id) return false;
  if (p.q) {
    // Meilisearch no longer sort-scopes retrieval either; this haystack never
    // included `description` to begin with, so description-only matches can't
    // occur on this backend — and this is a degraded dev-only preview, not
    // the prod search path.
    const hay = `${j.title} ${j.company ?? ""} ${j.location ?? ""} ${(j.tags ?? []).join(" ")}`.toLowerCase();
    const fitPhrases = resolveFitPhrases(p);
    if (fitPhrases) {
      if (!fitPhrases.some((phrase) => hay.includes(phrase.toLowerCase()))) return false;
    } else if (!hay.includes(p.q.toLowerCase())) {
      return false;
    }
  }
  if (p.salaryMin && p.salaryMin > 0) {
    const s = j.salary_max ?? j.salary_min ?? null;
    if (s == null || s < p.salaryMin) return false;
  }
  if (p.visaOnly && j.visa_sponsorship !== true) return false;
  if (!passPostedBucket(j, p.postedBucket)) return false;
  // Mirrors meilisearch.ts's `postedSinceMs` clause — an absolute floor,
  // independent of the relative `postedBucket` windows above.
  if (p.postedSinceMs != null) {
    const ts = derivePostedTs(j);
    if (ts == null || ts < p.postedSinceMs) return false;
  }
  if (p.board) {
    const domains = getBoardDomains(p.board as BoardId);
    if (domains.length > 0 && !domains.includes((j.company_domain ?? "").toLowerCase())) return false;
  }
  if (p.companyDomain) {
    if ((j.company_domain ?? "").toLowerCase() !== p.companyDomain.trim().toLowerCase()) return false;
  }
  return true;
}

function passFacet(j: PublicJob, key: FacetKey, vals: string[] | undefined): boolean {
  if (!vals || vals.length === 0) return true;
  return facetValueMatches(key, facetValue(j, key), vals);
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
  const sortMode = resolveEffectiveSort(p);
  const filtered = corpus
    .filter((j) => passBase(j, p) && passFacets(j, p))
    .sort((a, b) => compareJobsBySort(a, b, sortMode));
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
