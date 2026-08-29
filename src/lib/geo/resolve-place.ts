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
 * word can coincidentally also name an obscure real place ("success" is a
 * Perth, WA suburb; "mobile" is a Brazilian municipality; bare "engineer" is
 * a Kenyan town; "enterprise" is Enterprise, AL). The corpus-count floor
 * (`PLACE_MIN_COUNT`, corpus-values.ts) doesn't catch this — a populous
 * suburb like Success, WA clears a real corpus's count floor easily. This
 * guard is a different, earlier check: it rejects recognition itself for
 * single-token candidates on the guard word set (`GUARD_WORDS` below — a
 * union of general-English common words, common-words.ts, and corpus-derived
 * job-title vocabulary, job-vocab.ts, since "enterprise" is a job-title word
 * common enough to hijack searches without being common ENGLISH), before any
 * corpus round trip. Multi-word phrases ("san francisco") are never checked
 * — a guard-word COLLISION is only possible for a single bare token. Callers
 * opt in per-call because it only makes sense for candidates extracted from
 * free-text search words — an explicitly-typed location is intentional
 * input, not a coincidental substring (see query-understanding.ts).
 */
import type { PlaceFilter } from "../jobs/types";
import type { Gazetteer, GazetteerCity, GazetteerCountry } from "./gazetteer";
import { haversineKm } from "./distance";
import { COMMON_WORDS } from "./common-words";
import { JOB_VOCAB } from "./job-vocab";
import { JOBS_SYNONYMS } from "../jobs/meilisearch";
import { subdivisionCandidates } from "./country-subdivisions";
import { capitalizeWords } from "@/lib/text-case";
import { resolveRegionPhrase, regionLabel } from "./regions";

/**
 * The guard's full word set: general-English common words (common-words.ts)
 * UNIONED with corpus-derived job-title vocabulary (job-vocab.ts) UNIONED
 * with every key this app registers as a Meilisearch query synonym
 * (JOBS_SYNONYMS, jobs/meilisearch.ts — derived, never hand-copied, so a
 * future synonym never has to remember to also list itself here). Three
 * different provenances because none of them alone covers the whole class:
 * "success" / "mobile" / "engineer" are common-English; "enterprise" is not
 * common English but IS extremely common as a job-title word ("Enterprise
 * Account Executive"); "swe" is neither — it's an app-specific abbreviation
 * that ALSO happens to be Sweden's ISO3 code, so a bare "swe" query resolved
 * to a Sweden place filter and ate the registered synonym before it ever
 * reached Meilisearch (search-audit.md class 2, #163's ISO3 branch). Built
 * once at module load; the chokepoint below stays a single check against one
 * combined set, not three lookups. */
const GUARD_WORDS: Set<string> = new Set([...COMMON_WORDS, ...JOB_VOCAB, ...Object.keys(JOBS_SYNONYMS)]);

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
  /** "exact" (default): only the literal value (case-insensitive) counts,
   *  gated on PLACE_MIN_COUNT (corpus-values.ts) — the value came from
   *  resolving a NAME, so it could coincidentally collide with an ordinary
   *  word.
   *  "prefix": also accept any corpus value starting with "<value> - " —
   *  the compound-region pattern real postings use ("Canada - Remote",
   *  "Canada - Toronto") that an exact match alone would miss.
   *  "literal": the candidate IS the whole, already-typed/picked string, not
   *  a name-derived guess — see `selectMatchingHits`'s "literal" branch for
   *  why this mode carries no PLACE_MIN_COUNT floor. */
  matchMode?: "exact" | "prefix" | "literal";
}

export type PlaceEntityType = "city" | "admin1" | "country" | "region";

export interface ResolvedPlaceEntity {
  type: PlaceEntityType;
  /** Canonical gazetteer display name. */
  name: string;
  /** Undefined for a `region` entity — it spans multiple countries, so no
   *  single code would be honest. */
  countryCode?: string;
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
  /** Index into `PlaceScan.tokens` where this match started. Only set by
   *  `scanPlacePhrases` (undefined for a resolver called directly on an
   *  already-extracted phrase, e.g. a `resolvePlacePhrase` unit test — the
   *  token list only exists inside the scan). Lets a caller
   *  (query-understanding.ts's S1 company-corroboration guard) reconstruct
   *  which ORIGINAL tokens sit immediately beside a match, without
   *  re-tokenizing the query itself. */
  startIndex?: number;
}

/** name + ISO2 + ISO3 + the "<name> - <region>" compound pattern real
 *  postings use ("Canada - Remote", "Canada - Toronto") — shared by phrase
 *  resolution below and by the IP country default (ip-default.ts), which
 *  starts from an ISO2 code instead of typed text but needs the identical
 *  expansion once it has a `GazetteerCountry`. For a country in
 *  `SUBDIVISION_EXPANSION_COUNTRIES` (country-subdivisions.ts), also
 *  includes its admin1 regions and top cities as further `location_country`
 *  candidates — the corpus tags many postings with the unnormalized region
 *  ("Ontario", "Toronto") instead of the country, and this is the single
 *  place every resolution path converges to fix that query-side. */
function countryCandidates(country: GazetteerCountry, gazetteer: Gazetteer): PlaceCandidate[] {
  return [
    { field: "location_country", value: country.name },
    { field: "location_country", value: country.iso2 },
    { field: "location_country", value: country.iso3 },
    { field: "location_country", value: country.name, matchMode: "prefix" },
    ...subdivisionCandidates(country, gazetteer),
  ];
}

function resolveCountry(normalized: string, gazetteer: Gazetteer): PlaceResolution | null {
  const byName = gazetteer.countriesByName.get(normalized);
  const byIso3 = normalized.length === 3 ? gazetteer.countriesByIso3.get(normalized.toUpperCase()) : undefined;
  const country = byName ?? byIso3;
  if (!country) return null;
  return {
    entity: { type: "country", name: country.name, countryCode: country.iso2 },
    candidates: countryCandidates(country, gazetteer),
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
  return country ? countryCandidates(country, gazetteer) : null;
}

/** A region/continent phrase ("North America", "EMEA", ...) resolves to ONE
 *  PlaceClause whose candidates are the UNION of every member country's own
 *  candidate set — built by calling `countryPlaceCandidates` per member, the
 *  same builder a direct country search uses, never a second one. Null when
 *  `normalized` isn't a recognized region (regions.ts) or when this
 *  gazetteer instance (e.g. a small test fixture) has none of the region's
 *  members — same fail-open shape every other resolver here has. */
function resolveRegion(normalized: string, gazetteer: Gazetteer): PlaceResolution | null {
  const members = resolveRegionPhrase(normalized);
  if (!members) return null;
  const candidates: PlaceCandidate[] = [];
  for (const iso2 of members) {
    const memberCandidates = countryPlaceCandidates(iso2, gazetteer);
    if (memberCandidates) candidates.push(...memberCandidates);
  }
  if (candidates.length === 0) return null;
  return {
    entity: { type: "region", name: regionLabel(normalized) ?? normalized, countryCode: undefined },
    candidates,
    countryScope: [],
    wordsConsumed: normalized.split(" ").length,
  };
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

/**
 * The country scope (`PlaceResolution.countryScope`) exists for exactly one
 * job: stop a same-named city in ANOTHER country from satisfying the clause
 * (the Richmond Hill, Ontario vs Richmond Hill, Georgia case `PlaceClause`
 * documents). When no candidate name is shared with another country there is
 * nothing for it to disambiguate — and applying it anyway is not free, it's
 * an AND against `location_country`, a field the corpus populates far less
 * reliably than `location_city`. Measured 2026-08-18 on the live index, the
 * 20 Bengaluru/Bangalore polymer postings carry `location_country` =
 * 'Bengaluru' (9, the city echoed into the country field) and 'United
 * States' (8, from raw text that literally reads "Bangalore, KA, IN,
 * 560066") against only 3 correct 'India' — so the scope discarded 17 of 20
 * genuine matches to guard against a collision that cannot exist, since
 * "Bengaluru" names one city on earth.
 *
 * So: scope only when it can actually disambiguate. When the primary name is
 * unambiguous we drop the scope AND drop any radius-neighbor candidate whose
 * own name IS ambiguous — an unscoped clause must never offer a value that
 * needed the scope to be safe. Ambiguous primaries keep both, unchanged.
 *
 * Pure so the decision is unit-testable without a gazetteer: `isAmbiguous`
 * is the only thing that needs one.
 */
export function scopeCityCandidates(
  candidates: readonly PlaceCandidate[],
  countryScope: readonly PlaceCandidate[],
  primaryName: string,
  isAmbiguous: (cityName: string) => boolean,
): { candidates: PlaceCandidate[]; countryScope: PlaceCandidate[] } {
  if (isAmbiguous(primaryName)) return { candidates: [...candidates], countryScope: [...countryScope] };
  return {
    candidates: candidates.filter((c) => c.field !== "location_city" || !isAmbiguous(c.value)),
    countryScope: [],
  };
}

/** Lowercase city names the gazetteer knows in more than one country — the
 *  only names a country scope can disambiguate. Built once per gazetteer
 *  instance, same memoized shape as `cityVariantIndex`. */
export function buildAmbiguousCityNames(gazetteer: Gazetteer): Set<string> {
  const countriesByName = new Map<string, Set<string>>();
  for (const list of gazetteer.citiesByName.values()) {
    for (const city of list) {
      const key = city.name.toLowerCase();
      let seen = countriesByName.get(key);
      if (!seen) countriesByName.set(key, (seen = new Set()));
      seen.add(city.countryCode.toUpperCase());
    }
  }
  return new Set([...countriesByName].filter(([, cc]) => cc.size > 1).map(([name]) => name));
}

const ambiguousCityNamesCache = new WeakMap<Gazetteer, Set<string>>();

function ambiguousCityNames(gazetteer: Gazetteer): Set<string> {
  let names = ambiguousCityNamesCache.get(gazetteer);
  if (!names) {
    names = buildAmbiguousCityNames(gazetteer);
    ambiguousCityNamesCache.set(gazetteer, names);
  }
  return names;
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
  // Renamed/transliterated cities: add every other known spelling of the
  // PRIMARY match as its own location_city candidate — see
  // `CITY_NAME_VARIANTS`'s doc for why the corpus needs this (split ingest
  // history across old/new names). Radius neighbors keep their own single
  // gazetteer spelling; a neighbor that's itself a renamed city gets this
  // same expansion the moment IT resolves as a primary match.
  for (const variant of cityVariantIndex(gazetteer).get(primary.name.toLowerCase()) ?? []) {
    const value = titleCase(variant);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ field: "location_city", value });
  }
  for (const neighbor of radiusNeighbors(primary, gazetteer)) addCity(neighbor);
  const country = gazetteer.countriesByIso2.get(primary.countryCode.toUpperCase());
  const ambiguous = ambiguousCityNames(gazetteer);
  const scoped = scopeCityCandidates(
    candidates,
    // Fails open to [] (unscoped) if the gazetteer has a city whose country
    // code isn't itself registered — never happens for the committed
    // artifact (both come from the same GeoNames dump) but keeps a
    // hand-built fixture from throwing instead of just being less precise.
    country ? countryCandidates(country, gazetteer) : [],
    primary.name,
    (name) => ambiguous.has(name.toLowerCase()),
  );
  return {
    entity: { type: "city", name: primary.name, countryCode: primary.countryCode },
    candidates: scoped.candidates,
    countryScope: scoped.countryScope,
    wordsConsumed: normalized.split(" ").length,
  };
}

/**
 * Renamed/transliterated cities: a curated map of alternate spelling
 * (lowercase) -> the gazetteer's canonical name (lowercase) for the SAME
 * real-world city. Distinct from `PLACE_ALIASES` below in both shape and
 * reason: an alias there is a nickname for an entity the gazetteer indexes
 * under no other name ("sf" -> San Francisco); a rename here is a full city
 * name whose corpus postings are genuinely SPLIT across both spellings
 * ("Bangalore" 6,753 active vs "Bengaluru" 8,514 active — neither one a typo
 * or a stray value, both real ingest history from before/after the city's
 * 2014 official rename). A lookup here must therefore expand candidates to
 * EVERY known spelling, not just resolve to one entity — see
 * `cityVariantIndex` below, which both this table's redirect AND a direct
 * canonical lookup ("bengaluru" typed straight) route through, so typing
 * either the old or the new name reaches every stored spelling alike.
 *
 * Checked at the same priority as `PLACE_ALIASES` — BEFORE the general
 * country/admin1/city ladder — because a rename can collide with an
 * unrelated same-named place the gazetteer legitimately indexes under its
 * own name ("Calcutta" is a real town in South Africa, pop. 35,864;
 * "Madras" a real town in Oregon, pop. 6,662 — both would otherwise win the
 * bare `citiesByName` lookup and silently resolve to the wrong country).
 *
 * Canonical values MUST exist in the gazetteer by name (verified against the
 * committed artifact when each entry was added); `cityVariantIndex` drops
 * any entry whose canonical the gazetteer doesn't recognize rather than
 * throwing (same fail-open shape as `resolveCity`'s `countryScope`), so a
 * future GeoNames refresh that drops a name — or a hand-built test fixture
 * that never had it — degrades to "no variants," not a crash. Extend this
 * table, never a hand-built filter, when a new renamed/transliterated city
 * turns up.
 */
const CITY_NAME_VARIANTS: Readonly<Record<string, string>> = {
  bangalore: "bengaluru",
  bombay: "mumbai",
  calcutta: "kolkata",
  madras: "chennai",
  kiev: "kyiv",
  saigon: "ho chi minh city",
  peking: "beijing",
  gurgaon: "gurugram",
};

/** Title-cases a multi-word name ("ho chi minh city" -> "Ho Chi Minh City")
 *  for a curated variant spelling that has no gazetteer-cased original to
 *  borrow (Meilisearch's `=` filter is case-insensitive per
 *  `resolveLocationFacet`'s doc, so this is display casing, not a matching
 *  requirement). Delegates rather than re-spelling the regex: the previous
 *  `\b\w` version was correct only while every variant stayed plain ASCII,
 *  and nothing in `CITY_NAME_VARIANTS` enforces that — one accented entry
 *  would have rendered "MontréAl". */
function titleCase(s: string): string {
  return capitalizeWords(s);
}

/**
 * Pure: `CITY_NAME_VARIANTS` -> canonical city name (lowercase) -> every
 * known spelling for it (the canonical plus each alias pointing at it),
 * gazetteer-validated. Exported so a table-integrity test can run it against
 * a deliberately-bad fixture table without touching the real
 * `CITY_NAME_VARIANTS` constant — a canonical the gazetteer doesn't
 * recognize is dropped, never included in the result.
 */
export function buildCityVariantIndex(
  variants: Readonly<Record<string, string>>,
  gazetteer: Gazetteer,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(variants)) {
    if (!gazetteer.citiesByName.has(canonical)) continue;
    const group = index.get(canonical) ?? [canonical];
    if (!group.includes(alias)) group.push(alias);
    index.set(canonical, group);
  }
  return index;
}

const cityVariantIndexCache = new WeakMap<Gazetteer, Map<string, string[]>>();

/** Memoized per gazetteer instance (production has exactly one, `loadGazetteer`'s
 *  memoized singleton; tests build small fixture gazetteers). */
function cityVariantIndex(gazetteer: Gazetteer): Map<string, string[]> {
  let idx = cityVariantIndexCache.get(gazetteer);
  if (!idx) {
    idx = buildCityVariantIndex(CITY_NAME_VARIANTS, gazetteer);
    cityVariantIndexCache.set(gazetteer, idx);
  }
  return idx;
}

/** One curated alias entry: a short/nickname phrase a searcher might type,
 *  and which SPECIFIC gazetteer entity it names. `kind` picks the resolver
 *  DIRECTLY (never the general country-then-admin1-then-city ambiguity
 *  ladder above) because at least one entry here (DC) points at a name
 *  ("washington") that's ALSO a US state and would resolve to the wrong
 *  entity if it replayed that ladder — the alias already knows which entity
 *  the searcher meant, so it should never re-guess. */
type PlaceAlias =
  | { kind: "country"; canonical: string }
  | { kind: "city"; canonical: string }
  /** A curated metro area with no single gazetteer entity — its anchor
   *  cities are named directly as an OR-group. Each anchor still goes
   *  through `resolveCity` (a real gazetteer entry, not a hand-built
   *  filter); only the CHOICE of which cities counts as the metro is
   *  curated, and each anchor contributes only itself, not its OWN radius
   *  expansion (the alias already names the metro's cities explicitly). */
  | { kind: "metro"; anchors: string[] };

/**
 * Small, hand-reviewed set of abbreviations/nicknames real searchers type
 * that the gazetteer's own name/ISO lookups never reach — either they're
 * shorter than `PLACE_MIN_LENGTH` ("UK", "SF", "LA", "DC", "US") or the
 * gazetteer only indexes countries by full name/ISO3 (a bare 2-letter ISO2
 * code is deliberately never a typed lookup key — see `PLACE_MIN_LENGTH`'s
 * doc). Checked at the very top of `resolvePlacePhrase`, AFTER the
 * common-word guard (so "us" — a real pronoun — still gets rejected in free
 * text the guard is protecting, while an explicit location-field "us"
 * resolves) and BEFORE the length gate (so these short keys are never
 * killed before they're even considered). Keys are lowercase; extend this
 * table, never a hand-built filter, when a new legitimate abbreviation
 * turns up.
 */
const PLACE_ALIASES: Readonly<Record<string, PlaceAlias>> = {
  uk: { kind: "country", canonical: "united kingdom" },
  "u.k.": { kind: "country", canonical: "united kingdom" },
  usa: { kind: "country", canonical: "united states" },
  us: { kind: "country", canonical: "united states" },
  "u.s.": { kind: "country", canonical: "united states" },
  "u.s.a.": { kind: "country", canonical: "united states" },
  nyc: { kind: "city", canonical: "new york city" },
  sf: { kind: "city", canonical: "san francisco" },
  la: { kind: "city", canonical: "los angeles" },
  dc: { kind: "city", canonical: "washington" },
  "bay area": { kind: "metro", anchors: ["san francisco", "oakland", "san jose"] },
};

/** Resolve one alias entry (see `PLACE_ALIASES`) against the gazetteer.
 *  `country`/`city` re-dispatch straight into the matching single-entity
 *  resolver above — never the general ambiguity ladder — so an alias always
 *  lands on the SPECIFIC entity it was curated for. `metro` merges each
 *  anchor's own primary-city candidate. Null if the gazetteer this call is
 *  running against doesn't actually have the aliased entity (e.g. a small
 *  hand-built test fixture) — same fail-open shape every other resolver
 *  here has. */
function resolveAlias(alias: PlaceAlias, wordsConsumed: number, gazetteer: Gazetteer): PlaceResolution | null {
  if (alias.kind === "metro") {
    const candidates: PlaceCandidate[] = [];
    let entity: ResolvedPlaceEntity | undefined;
    let countryScope: PlaceCandidate[] = [];
    for (const name of alias.anchors) {
      const r = resolveCity(name, gazetteer);
      if (!r) continue;
      candidates.push({ field: "location_city", value: r.entity.name });
      if (!entity) {
        entity = r.entity;
        countryScope = r.countryScope;
      }
    }
    return entity ? { entity, candidates, countryScope, wordsConsumed } : null;
  }
  const resolver = alias.kind === "country" ? resolveCountry : resolveCity;
  const r = resolver(alias.canonical, gazetteer);
  return r ? { ...r, wordsConsumed } : null;
}

/**
 * Resolve one already-extracted phrase (a candidate n-gram from
 * `scanPlacePhrases`) against the gazetteer. Returns null for anything that
 * isn't a real place — "production", "management", "remote" never match
 * because no such country/admin1/city exists, not because of a hand-written
 * denylist.
 *
 * `guardCommonWords` (default off): when true, also rejects a single-token
 * phrase that's on the guard word set (`GUARD_WORDS` above — common English
 * plus corpus-derived job vocabulary), even though it WOULD otherwise
 * resolve — see the module doc's "Common-word guard" section. Off by
 * default because most gazetteer resolution (an
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
  // Runs BEFORE the alias lookup so a genuinely ambiguous alias key ("us",
  // also the pronoun) still gets rejected in free text — see PLACE_ALIASES'
  // doc comment. Uses the full GUARD_WORDS tier (#163: common English +
  // corpus job vocabulary), which subsumes the old COMMON_WORDS-only guard.
  if (guardCommonWords && !normalized.includes(" ") && GUARD_WORDS.has(normalized)) return null;

  const alias = PLACE_ALIASES[normalized];
  if (alias) return resolveAlias(alias, normalized.split(" ").length, gazetteer);

  // Renamed-city redirect (CITY_NAME_VARIANTS) — same priority tier as
  // PLACE_ALIASES and for the same reason: must win outright over the
  // general ladder below, since a rename can collide with an unrelated
  // same-named place the gazetteer indexes under its own name (see the
  // table's doc — "Calcutta"/"Madras"). Resolving via `resolveCity` (not the
  // alias table's `kind: "city"` path) is what makes the variant expansion
  // above fire: it runs off `primary.name`, which is always the canonical
  // spelling this redirect looks up. Fails open to null if the gazetteer
  // this call is running against doesn't have the canonical (a hand-built
  // test fixture, or a future GeoNames refresh) — same shape every resolver
  // here has.
  const renamedCanonical = CITY_NAME_VARIANTS[normalized];
  if (renamedCanonical) {
    const r = resolveCity(renamedCanonical, gazetteer);
    return r ? { ...r, wordsConsumed: normalized.split(" ").length } : null;
  }

  // Region/continent phrases ("North America", "EMEA", "APAC", ...) — same
  // priority tier as PLACE_ALIASES/CITY_NAME_VARIANTS and for the same
  // reason: several are shorter than PLACE_MIN_LENGTH ("EU") and would
  // otherwise be killed by the length gate below before ever being
  // considered. See regions.ts for the alias table.
  const region = resolveRegion(normalized, gazetteer);
  if (region) return region;

  if (normalized.length < PLACE_MIN_LENGTH) return null;
  if (/\d/.test(normalized)) return null;

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
  /** The whitespace/punctuation-split token list this scan matched against
   *  (same split `resolutions[i].startIndex` indexes into) — exposed so a
   *  caller can reconstruct context around a match without re-tokenizing
   *  the query itself (see `PlaceResolution.startIndex`'s doc). */
  tokens: string[];
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
      resolutions.push({ ...matched, startIndex: i });
      i += matched.wordsConsumed;
    } else {
      kept.push(tokens[i]);
      i += 1;
    }
  }
  return { residualQ: kept.join(" "), resolutions, tokens };
}

/**
 * Pure: rebuild `{ residualQ, resolutions }` once an async guard downstream
 * (query-understanding.ts's S1 company-corroboration check) has decided some
 * of `scanPlacePhrases`'s resolutions are better explained as something else
 * — a rejected resolution's original token span goes back into the residual
 * text exactly where it lived, in the same left-to-right order every other
 * kept token already follows, rather than just being dropped or appended.
 * Symmetric with `scanPlacePhrases` itself: same token-walk shape, just
 * choosing "keep as resolution" vs "keep as text" per `rejected` instead of
 * "matched vs unmatched".
 */
export function rebuildAfterRejection(
  tokens: string[],
  resolutions: readonly PlaceResolution[],
  rejected: (r: PlaceResolution) => boolean,
): { residualQ: string; resolutions: PlaceResolution[] } {
  const byStart = new Map(resolutions.map((r) => [r.startIndex ?? 0, r]));
  const kept: string[] = [];
  const survivors: PlaceResolution[] = [];
  let i = 0;
  while (i < tokens.length) {
    const r = byStart.get(i);
    if (r) {
      if (rejected(r)) kept.push(...tokens.slice(i, i + r.wordsConsumed));
      else survivors.push(r);
      i += r.wordsConsumed;
    } else {
      kept.push(tokens[i]);
      i += 1;
    }
  }
  return { residualQ: kept.join(" "), resolutions: survivors };
}
