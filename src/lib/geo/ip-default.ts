/**
 * IP-based country default: when a search carries no location signal at
 * all, default it to the requester's own country rather than showing an
 * undifferentiated global result set. An explicit user choice — a typed
 * place or the MCP `location` param (both land in `places`), or an explicit
 * `location_country` facet click — always wins; this only ever fires on
 * their absence (see `hasLocationSignal`). A searcher can also veto
 * defaulting outright (the /jobs default-location chip's "×",
 * `suppressLocationDefault`) without typing anything — same gate, honored
 * independent of whether a signal happens to be present too.
 */
import type { JobSearchParams, PlaceClause } from "../jobs/types";
import type { Gazetteer } from "./gazetteer";
import { countryPlaceCandidates, placeClause } from "./resolve-place";
import type { CorpusValueChecker } from "./corpus-values";
import type { CountryLookup } from "./ip-country";

/**
 * True when `resolveLocationDefault` must NOT run — either the searcher
 * already said WHERE (a typed/MCP place landed in `places`, or an explicit
 * `location_country` facet click), or they said "don't guess"
 * (`suppressLocationDefault`, set once and persisted client-side after the
 * default-location chip is dismissed). The two are independent: an explicit
 * place always wins on its own, and the override holds even for a query
 * that carries no place at all.
 */
export function hasLocationSignal(
  p: Pick<JobSearchParams, "places" | "facets" | "suppressLocationDefault">,
): boolean {
  return (
    Boolean(p.suppressLocationDefault) ||
    Boolean(p.places?.length) ||
    Boolean(p.facets?.location_country?.length)
  );
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
  return { places: [placeClause(any, { country: true })], countryCode: iso2 };
}

/**
 * Resolve a country ISO2 to the same `places` clause shape
 * `resolveLocationDefault` above would produce for it — built straight from
 * the bundled gazetteer, no corpus-value validation (that step is a live
 * Meilisearch facet-search call; skipping it is what keeps this cheap enough
 * to run on every request, outside any caller's own response cache). A
 * country genuinely absent from the corpus just yields zero hits, same as
 * any other search with an obscure filter — not a failure. Used by the
 * cached cold-visit /jobs front door (`getDefaultBrowseAction`,
 * `getCachedBoardCountNew` in actions/jobs.ts).
 */
export function placesForCountry(iso2: string, gazetteer: Gazetteer): PlaceClause[] | undefined {
  const candidates = countryPlaceCandidates(iso2, gazetteer);
  return candidates?.length ? [placeClause(candidates, { country: true })] : undefined;
}

export interface LocationDefaultApplication {
  /** `params` unchanged (same reference) when nothing about it should
   *  change — a caller can tell whether this fired from `defaultedLocation`
   *  alone, never by diffing `params`. */
  params: JobSearchParams;
  /** ISO2, present only when the default actually applied. */
  defaultedLocation?: string;
  /** Whether the applied default's own place clause also OR's in every
   *  remote role with no country tag (`PlaceClause.remoteAnywhere`,
   *  resolve-place.ts) — read off the SAME clause `params.places` now holds,
   *  never assumed. A country-level default sets it unconditionally today
   *  (`placeClause(any, { country: true })`), but this derives it rather
   *  than hardcoding that fact, so a UI label built from it can't go stale
   *  if that ever changes. Present only alongside `defaultedLocation`. */
  remoteAnywhere?: boolean;
}

/**
 * The full "should the IP default apply, and if so, what does it change"
 * decision — the ONE chokepoint `searchJobs` (jobs/search.ts) calls right
 * after query understanding, so this exact gating logic is unit-testable
 * without a real Meilisearch backend (no network in this function at all;
 * `loadContext` is the only I/O, and only runs when everything else already
 * says the default might apply). `ip`/`countryLookup` missing (every caller
 * except the browser-facing action) is itself a no-op, same as
 * `hasLocationSignal` returning true.
 */
export async function applyLocationDefault(
  params: JobSearchParams,
  ip: string | undefined,
  countryLookup: CountryLookup | undefined,
  loadContext: () => Promise<{ gazetteer: Gazetteer; corpusChecker: CorpusValueChecker }>,
): Promise<LocationDefaultApplication> {
  if (!ip || !countryLookup || params.id || hasLocationSignal(params)) return { params };
  const { gazetteer, corpusChecker } = await loadContext();
  const ipDefault = await resolveLocationDefault(ip, gazetteer, corpusChecker, countryLookup);
  if (!ipDefault) return { params };
  return {
    params: { ...params, places: ipDefault.places },
    defaultedLocation: ipDefault.countryCode,
    remoteAnywhere: ipDefault.places.some((place) => place.remoteAnywhere),
  };
}
