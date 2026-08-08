/**
 * Gazetteer-backed place resolution — pure, no I/O (see corpus-values.ts for
 * the layer that checks these candidates against what the corpus actually
 * contains).
 *
 * Recognizing a typed phrase as a real-world place is now the gazetteer's
 * job, not a corpus-text heuristic: the old approach (query-understanding.ts,
 * pre-gazetteer) could only ever match places the corpus's capped facet
 * distribution happened to surface, and told junk apart from real places
 * with a hand-tuned count floor + denylist. A gazetteer entry IS a real
 * place by construction, so recognition here needs no count floor and no
 * enumerated junk list — the class-wide guard is "exists in GeoNames."
 *
 * Ambiguity policy: a phrase can name an admin1 region/country AND a
 * same-named city ("Ontario" the Canadian province vs. Ontario, California;
 * "Georgia" the country vs. the US state). Administrative names win outright
 * — they're what a jobs search overwhelmingly means by a bare place word,
 * and unlike a city match they never trigger radius expansion (the
 * highest-blast-radius mechanism below), so guessing wrong here is cheap:
 * country and admin1 candidates merge (OR) when a phrase matches both, and
 * city resolution — including its radius neighbors — only runs when NEITHER
 * matched.
 *
 * Common-word guard (opt-in, see `resolvePlacePhrase`'s `guardCommonWords`
 * param): a SINGLE-token phrase is still real GeoNames data, but an ordinary
 * English word can coincidentally also name an obscure real place ("success"
 * is a Perth, WA suburb; "mobile" is a Brazilian municipality; bare
 * "engineer" is a Kenyan town). The corpus-count floor (`PLACE_MIN_COUNT`,
 * corpus-values.ts) doesn't catch this — a populous suburb like Success, WA
 * clears a real corpus's count floor easily. This guard is a different,
 * earlier check: it rejects recognition itself for single-token candidates
 * on the common-word list (common-words.ts), before any corpus round trip.
 * Multi-word phrases ("san francisco") are never checked — a common-word
 * COLLISION is only possible for a single bare token. Callers opt in
 * per-call because it only makes sense for candidates extracted from
 * free-text search words — an explicitly-typed location is intentional
 * input, not a coincidental substring (see query-understanding.ts).
 */
import type { PlaceFilter } from "../jobs/types";
import type { Gazetteer, GazetteerCity, GazetteerCountry } from "./gazetteer";
import { haversineKm } from "./distance";
import { COMMON_WORDS } from "./common-words";

/** No 1-2 letter phrase is ever looked up as a place — "OR"/"IN"/"ME" are
 *  real corpus values (Oregon, Indiana, Maine) but collide with English
 *  words at that length. Full names ("Oregon") always clear this; a bare
 *  admin1/ISO2 code only ever reaches the corpus as part of an EXPANSION
 *  (added after a full-name match resolves), never as a typed lookup key. */
export const PLACE_MIN_LENGTH = 3;

/** Same-country radius for a city's "nearby" expansion (Toronto -> Markham,
 *  Mississauga, Brampton, ...). */
export const PLACE_RADIUS_KM = 50;

/** Caps the radius expansion's candidate (and downstream corpus-validation
 *  network call) count for a densely-packed metro area — kept to the most
 *  populous neighbors, which are also the ones most likely to actually
 *  appear in a jobs corpus. */
export const PLACE_RADIUS_MAX_NEIGHBORS = 40;

export type LocationField = PlaceFilter["field"];

export interface PlaceCandidate {
  field: LocationField;
  /** Candidate text in gazetteer casing — NOT yet known to exist in the
   *  corpus; corpus-values.ts is what turns this into a real filter. */
  value: string;
  /** "exact" (default): only the literal value (case-insensitive) counts.
   *  "prefix": also accept any corpus value starting with "<value> - " —
   *  the compound-region pattern real postings use ("Canada - Remote",
   *  "Canada - Toronto") that an exact match alone would miss. */
  matchMode?: "exact" | "prefix";
}

export type PlaceEntityType = "city" | "admin1" | "country";

export interface ResolvedPlaceEntity {
  type: PlaceEntityType;
  /** Canonical gazetteer display name. */
  name: string;
  countryCode: string;
}

export interface PlaceResolution {
  entity: ResolvedPlaceEntity;
  /** Unvalidated expansion set — see corpus-values.ts. */
  candidates: PlaceCandidate[];
  /**
   * For a CITY resolution only: the resolved country's own candidate set
   * (same shape `countryCandidates` produces), which query-understanding.ts
   * ANDs against `candidates` once both validate. Without this, a same-named
   * city in a different country satisfies the filter too — a Georgia, US
   * "Richmond Hill" row matching a Richmond Hill, ONTARIO radius match. Empty
   * for admin1/country resolutions: they already ARE the country/region,
   * nothing left to scope by.
   */
  countryScope: PlaceCandidate[];
  /** How many whitespace-delimited words of the input this consumed, so the
   *  greedy scanner (scanPlacePhrases) knows how far to advance. */
  wordsConsumed: number;
}

/** name + ISO2 + ISO3 + the "<name> - <region>" compound pattern real
 *  postings use ("Canada - Remote", "Canada - Toronto") — shared by phrase
 *  resolution below and by the IP country default (ip-default.ts), which
 *  starts from an ISO2 code instead of typed text but needs the identical
 *  expansion once it has a `GazetteerCountry`. */
function countryCandidates(country: GazetteerCountry): PlaceCandidate[] {
  return [
    { field: "location_country", value: country.name },
    { field: "location_country", value: country.iso2 },
    { field: "location_country", value: country.iso3 },
    { field: "location_country", value: country.name, matchMode: "prefix" },
  ];
}

function resolveCountry(normalized: string, gazetteer: Gazetteer): PlaceResolution | null {
  const byName = gazetteer.countriesByName.get(normalized);
  const byIso3 = normalized.length === 3 ? gazetteer.countriesByIso3.get(normalized.toUpperCase()) : undefined;
  const country = byName ?? byIso3;
  if (!country) return null;
  return {
    entity: { type: "country", name: country.name, countryCode: country.iso2 },
    candidates: countryCandidates(country),
    countryScope: [],
    wordsConsumed: normalized.split(" ").length,
  };
}

/** ISO2 -> the same name/ISO2/ISO3/compound expansion set a typed country
 *  name would produce — the IP country default (ip-default.ts) reuses this
 *  rather than re-deriving candidates from a code the resolver above never
 *  takes as typed input (see PLACE_MIN_LENGTH). Null for an ISO2 the
 *  gazetteer doesn't recognize. */
export function countryPlaceCandidates(iso2: string, gazetteer: Gazetteer): PlaceCandidate[] | null {
  const country = gazetteer.countriesByIso2.get(iso2.toUpperCase());
  return country ? countryCandidates(country) : null;
}

function resolveAdmin1(normalized: string, gazetteer: Gazetteer): PlaceResolution | null {
  const matches = gazetteer.admin1ByName.get(normalized);
  if (!matches || matches.length === 0) return null;
  const candidates: PlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const a of matches) {
    for (const value of [a.name, a.code]) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ field: "location_state", value });
    }
  }
  return {
    entity: { type: "admin1", name: matches[0].name, countryCode: matches[0].countryCode },
    candidates,
    countryScope: [],
    wordsConsumed: normalized.split(" ").length,
  };
}

/** Cities within `PLACE_RADIUS_KM` of `city`, same country, excluding
 *  `city` itself, most-populous first, capped at
 *  `PLACE_RADIUS_MAX_NEIGHBORS`. */
function radiusNeighbors(city: GazetteerCity, gazetteer: Gazetteer): GazetteerCity[] {
  const sameCountry = gazetteer.citiesByCountry.get(city.countryCode) ?? [];
  return sameCountry
    .filter((c) => c !== city && haversineKm(city.lat, city.lng, c.lat, c.lng) <= PLACE_RADIUS_KM)
    .sort((a, b) => b.population - a.population)
    .slice(0, PLACE_RADIUS_MAX_NEIGHBORS);
}

function resolveCity(normalized: string, gazetteer: Gazetteer): PlaceResolution | null {
  const matches = gazetteer.citiesByName.get(normalized);
  if (!matches || matches.length === 0) return null;
  // A bare name can be ambiguous worldwide (many "Springfield"s) — the
  // most populous match is the disambiguation anchor, both for the entity
  // reported and for centering the radius search. Population, not an
  // enumerated list, is the tie-break — class-wide by construction.
  const primary = matches.reduce((a, b) => (b.population > a.population ? b : a));
  const candidates: PlaceCandidate[] = [];
  const seen = new Set<string>();
  const addCity = (c: GazetteerCity) => {
    for (const value of [c.name, c.nativeName].filter((v): v is string => Boolean(v))) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ field: "location_city", value });
    }
  };
  addCity(primary);
  for (const neighbor of radiusNeighbors(primary, gazetteer)) addCity(neighbor);
  const country = gazetteer.countriesByIso2.get(primary.countryCode.toUpperCase());
  return {
    entity: { type: "city", name: primary.name, countryCode: primary.countryCode },
    candidates,
    // Fails open to [] (unscoped) if the gazetteer has a city whose country
    // code isn't itself registered — never happens for the committed
    // artifact (both come from the same GeoNames dump) but keeps a
    // hand-built fixture from throwing instead of just being less precise.
    countryScope: country ? countryCandidates(country) : [],
    wordsConsumed: normalized.split(" ").length,
  };
}

/**
 * Resolve one already-extracted phrase (a candidate n-gram from
 * `scanPlacePhrases`) against the gazetteer. Returns null for anything that
 * isn't a real place — "production", "management", "remote" never match
 * because no such country/admin1/city exists, not because of a hand-written
 * denylist.
 *
 * `guardCommonWords` (default off): when true, also rejects a single-token
 * phrase that's on the general-English common-word list (common-words.ts),
 * even though it WOULD otherwise resolve — see the module doc's "Common-word
 * guard" section. Off by default because most gazetteer resolution (an
 * explicitly-typed location, the IP-default expansion, these tests) has no
 * reason to second-guess a real place; only the free-text query scanner
 * (query-understanding.ts) opts in.
 */
export function resolvePlacePhrase(
  phrase: string,
  gazetteer: Gazetteer,
  guardCommonWords = false,
): PlaceResolution | null {
  const normalized = phrase.trim().toLowerCase();
  if (normalized.length < PLACE_MIN_LENGTH) return null;
  if (/\d/.test(normalized)) return null;
  if (guardCommonWords && !normalized.includes(" ") && COMMON_WORDS.has(normalized)) return null;

  const country = resolveCountry(normalized, gazetteer);
  const admin1 = resolveAdmin1(normalized, gazetteer);
  if (country || admin1) {
    return {
      entity: (country ?? admin1)!.entity,
      candidates: [...(country?.candidates ?? []), ...(admin1?.candidates ?? [])],
      countryScope: [],
      wordsConsumed: normalized.split(" ").length,
    };
  }
  return resolveCity(normalized, gazetteer);
}

export interface PlaceScan {
  /** Query text with matched place phrases removed. */
  residualQ: string;
  resolutions: PlaceResolution[];
}

/**
 * Greedy longest-phrase-first scan of free text against the gazetteer —
 * same tokenization and consume-longest-match-first shape as the corpus-
 * vocabulary scanner it replaces, so "senior engineer new york" still tries
 * "senior engineer new" before "new york" before "new"/"york" alone.
 *
 * `guardCommonWords` passes straight through to `resolvePlacePhrase` on
 * every candidate phrase this scan tries (see that function's doc).
 */
export function scanPlacePhrases(q: string, gazetteer: Gazetteer, guardCommonWords = false): PlaceScan {
  const tokens = q.split(/[\s,;/\-–—()]+/).filter(Boolean);
  const resolutions: PlaceResolution[] = [];
  const kept: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched: PlaceResolution | null = null;
    for (let len = Math.min(gazetteer.maxGram, tokens.length - i); len >= 1 && !matched; len--) {
      matched = resolvePlacePhrase(tokens.slice(i, i + len).join(" "), gazetteer, guardCommonWords);
    }
    if (matched) {
      resolutions.push(matched);
      i += matched.wordsConsumed;
    } else {
      kept.push(tokens[i]);
      i += 1;
    }
  }
  return { residualQ: kept.join(" "), resolutions };
}
