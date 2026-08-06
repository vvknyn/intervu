/**
 * Corpus validation layer: turns gazetteer expansion candidates
 * (resolve-place.ts) into real filter clauses, enforcing the one invariant
 * query-understanding.ts has always relied on — "an alias can never invent
 * a filter the corpus can't satisfy." A gazetteer match proves a phrase
 * NAMES a real place; it says nothing about whether THIS corpus has any
 * postings tagged with it, so every candidate still has to clear a live
 * check before it can become a filter.
 *
 * Backed by Meilisearch's `/facet-search` endpoint (typeahead-style: "does
 * this value exist in this facet") rather than the old bulk
 * `fetchLocationFacetDistributions` approach, which only ever saw the
 * top ~300 values per field by count — exactly why "Markham" (349) and
 * "MISSISSAUGA" (1,306, below the cap only because bigger cities crowd it
 * out) never made it into the old vocabulary. facet-search asks about one
 * specific value directly, so it reaches the long tail a bulk top-N fetch
 * structurally cannot.
 *
 * Latency: resolution is O(cached lookups) in steady state. Per unique
 * (field, value) query, one facet-search call the FIRST time any request
 * asks about it; every candidate that shares that (field, value) — across
 * requests, across users — hits the in-memory cache instead. Matches the
 * existing vocabCache pattern in jobs/search.ts (cold-start cost paid once
 * per server instance per TTL window, not per keystroke).
 */
import type { PlaceFilter } from "../jobs/types";
import type { LocationField, PlaceCandidate } from "./resolve-place";

export interface FacetHit {
  /** The value's REAL casing as stored in the corpus — Meilisearch's `=`
   *  filter is case-sensitive, so this (never the candidate's gazetteer
   *  casing) is what ends up in the filter. */
  value: string;
  count: number;
}

/** Live lookup: which corpus values match `query` in `field`. Null means the
 *  call couldn't be answered (no backend configured, network failure) —
 *  distinct from `[]`, a real "nothing matches" answer. */
export type FacetSearchFetcher = (field: LocationField, query: string) => Promise<FacetHit[] | null>;

/**
 * Pure: given the raw hits a facet-search for `candidate.value` returned,
 * which ones does this candidate actually license? "exact" keeps only the
 * literal case-insensitive match. "prefix" additionally keeps every hit
 * starting with "<value> - " — the compound-region pattern ("Canada -
 * Remote", "Canada - Toronto") — still gated on the hit being a REAL corpus
 * value, never a pattern invented from the candidate alone.
 */
export function selectMatchingHits(candidate: PlaceCandidate, hits: readonly FacetHit[]): PlaceFilter[] {
  const needle = candidate.value.trim().toLowerCase();
  const out: PlaceFilter[] = [];
  for (const hit of hits) {
    const hay = hit.value.trim().toLowerCase();
    if (hay === needle || (candidate.matchMode === "prefix" && hay.startsWith(`${needle} - `))) {
      out.push({ field: candidate.field, value: hit.value });
    }
  }
  return out;
}

export type CorpusValueChecker = (candidates: PlaceCandidate[]) => Promise<PlaceFilter[]>;

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function cacheKey(field: LocationField, value: string): string {
  return `${field}:${value.trim().toLowerCase()}`;
}

/**
 * I/O wrapper around `selectMatchingHits`: caches facet-search results per
 * (field, value) so repeat candidates (the common case — "Toronto",
 * "Canada", "United States" get typed constantly) never re-hit the network.
 * A failed/unconfigured fetch (`null`) is never cached — it fails OPEN for
 * this call (candidate simply doesn't resolve) without poisoning future
 * requests once the backend recovers.
 */
export function createCorpusValueChecker(fetch: FacetSearchFetcher, ttlMs = DEFAULT_TTL_MS): CorpusValueChecker {
  const cache = new Map<string, { hits: FacetHit[]; at: number }>();

  async function hitsFor(field: LocationField, value: string): Promise<FacetHit[]> {
    const key = cacheKey(field, value);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < ttlMs) return cached.hits;
    const hits = await fetch(field, value);
    if (hits === null) return cached?.hits ?? [];
    cache.set(key, { hits, at: Date.now() });
    return hits;
  }

  return async (candidates: PlaceCandidate[]): Promise<PlaceFilter[]> => {
    const queries = new Map<string, { field: LocationField; value: string }>();
    for (const c of candidates) queries.set(cacheKey(c.field, c.value), { field: c.field, value: c.value });

    const hitsByKey = new Map<string, FacetHit[]>();
    await Promise.all(
      [...queries.entries()].map(async ([key, { field, value }]) => {
        hitsByKey.set(key, await hitsFor(field, value));
      }),
    );

    const seen = new Set<string>();
    const out: PlaceFilter[] = [];
    for (const candidate of candidates) {
      const hits = hitsByKey.get(cacheKey(candidate.field, candidate.value)) ?? [];
      for (const filter of selectMatchingHits(candidate, hits)) {
        const key = `${filter.field} ${filter.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(filter);
        }
      }
    }
    return out;
  };
}
