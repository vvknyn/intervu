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
 * requests, across users, across candidate GROUPS in the same call — hits
 * the in-memory cache instead. Matches the existing vocabCache pattern in
 * jobs/search.ts (cold-start cost paid once per server instance per TTL
 * window, not per keystroke).
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
 * A facet value must describe at least this many postings to license an
 * EXACT match. Gazetteer recognition proves a phrase names a real
 * real-world place, but says nothing about how likely it is to be what a
 * searcher meant versus a coincidental collision with an ordinary word —
 * "Engineer" is a real Kenyan town (pop. 5,324) that a corpus can pick up
 * 1-2 stray postings for (bad location data, not genuine "jobs in
 * Engineer, Kenya" demand), and "engineer" is one of the single most
 * common words in a job search. Measured 2026-07-26 against this exact
 * corpus for the identical purpose (the pre-gazetteer vocabulary's
 * PLACE_MIN_COUNT): genuine cities run 100s-10,000s; noise like
 * "Production"(26)/"Management"(46) sits well below. Reused verbatim here
 * rather than re-tuned, since it's the same signal (facet-search's `count`
 * is the same per-value posting count the old bulk distribution exposed).
 *
 * Does NOT apply to prefix-mode compound matches ("Canada - Remote"): a
 * compound region tag can only exist because the corpus already carries
 * that exact literal string, so there's no coincidental-word-collision risk
 * to guard against, and compounds are legitimately long-tail (Canada -
 * Toronto: 55).
 */
export const PLACE_MIN_COUNT = 100;

/**
 * Pure: given the raw hits a facet-search for `candidate.value` returned,
 * which ones does this candidate actually license? "exact" keeps only the
 * literal case-insensitive match, and only when it clears PLACE_MIN_COUNT.
 * "prefix" additionally keeps every hit starting with "<value> - " — the
 * compound-region pattern ("Canada - Remote", "Canada - Toronto") — still
 * gated on the hit being a REAL corpus value, never a pattern invented from
 * the candidate alone, but with no count floor (see PLACE_MIN_COUNT's doc).
 */
export function selectMatchingHits(candidate: PlaceCandidate, hits: readonly FacetHit[]): PlaceFilter[] {
  const needle = candidate.value.trim().toLowerCase();
  const out: PlaceFilter[] = [];
  for (const hit of hits) {
    const hay = hit.value.trim().toLowerCase();
    if (hay === needle) {
      if (hit.count < PLACE_MIN_COUNT) continue;
      out.push({ field: candidate.field, value: hit.value });
    } else if (candidate.matchMode === "prefix" && hay.startsWith(`${needle} - `)) {
      out.push({ field: candidate.field, value: hit.value });
    }
  }
  return out;
}

/**
 * Validates N independent candidate groups in one batched round of network
 * calls, returning validated filters per group (same order/length as the
 * input). Grouped rather than one flat batch so a caller can keep a city
 * resolution's own candidates separate from its country-scope candidates
 * (query-understanding.ts) without a second, un-cached round trip — the
 * underlying facet-search hits are still fetched (and cached) exactly once
 * per unique (field, value) regardless of which group(s) reference it.
 */
export type CorpusValueChecker = (candidateGroups: PlaceCandidate[][]) => Promise<PlaceFilter[][]>;

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

  return async (candidateGroups: PlaceCandidate[][]): Promise<PlaceFilter[][]> => {
    const queries = new Map<string, { field: LocationField; value: string }>();
    for (const c of candidateGroups.flat()) queries.set(cacheKey(c.field, c.value), { field: c.field, value: c.value });

    const hitsByKey = new Map<string, FacetHit[]>();
    await Promise.all(
      [...queries.entries()].map(async ([key, { field, value }]) => {
        hitsByKey.set(key, await hitsFor(field, value));
      }),
    );

    return candidateGroups.map((candidates) => {
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
    });
  };
}
