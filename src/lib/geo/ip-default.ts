/**
 * IP-based country default: when a search carries no location signal at
 * all, default it to the requester's own country rather than showing an
 * undifferentiated global result set. An explicit user choice — a typed
 * place or the MCP `location` param (both land in `places`), or an explicit
 * `location_country` facet click — always wins; this only ever fires on
 * their absence (see `hasLocationSignal`).
 */
import type { JobSearchParams, PlaceClause } from "../jobs/types";
import type { Gazetteer } from "./gazetteer";
import { countryPlaceCandidates } from "./resolve-place";
import type { CorpusValueChecker } from "./corpus-values";
import type { CountryLookup } from "./ip-country";

/** True once the caller has said ANYTHING about where they want jobs from —
 *  a typed/MCP place (`places`, filled in by query understanding before this
 *  runs) or an explicit `location_country` facet click. */
export function hasLocationSignal(p: Pick<JobSearchParams, "places" | "facets">): boolean {
  return Boolean(p.places?.length) || Boolean(p.facets?.location_country?.length);
}

export interface LocationDefault {
  places: PlaceClause[];
  /** ISO2 the default was resolved from — the caller stamps this onto the
   *  response as `defaultedLocation` so the UI can render a clearable chip. */
  countryCode: string;
}

/**
 * Resolves to null when there's nothing to default with: the IP doesn't map
 * to a country (missing mmdb, private/unroutable address, lookup failure),
 * the gazetteer doesn't recognize the ISO2 db-ip returned, or — the same
 * "never invent a filter the corpus can't satisfy" invariant every other
 * place resolution honors — the corpus has no postings tagged with that
 * country at all.
 */
export async function resolveLocationDefault(
  ip: string,
  gazetteer: Gazetteer,
  corpusChecker: CorpusValueChecker,
  countryLookup: CountryLookup,
): Promise<LocationDefault | null> {
  const iso2 = await countryLookup(ip);
  if (!iso2) return null;
  const candidates = countryPlaceCandidates(iso2, gazetteer);
  if (!candidates) return null;
  const [any] = await corpusChecker([candidates]);
  if (any.length === 0) return null;
  // A country-level default IS the country — nothing left to further scope.
  return { places: [{ any }], countryCode: iso2 };
}
