/**
 * Bare-country expansion: `location_country` in the corpus holds
 * unnormalized place strings, not just countries — a Canada search misses
 * every job tagged "Ontario"/"Toronto"/"British Columbia" instead of
 * "Canada", and a UK search misses "London" instead of "United Kingdom"
 * (see resolve-place.ts's `countryCandidates`, the sole caller). This module
 * is that widening's pure decision logic: for a fixed set of countries whose
 * subdivision names are large enough to matter and unambiguous enough to be
 * safe, add their admin1 regions and top cities as additional
 * `location_country` OR-candidates.
 *
 * Query-side only — the underlying data stays unnormalized; a Postgres pass
 * to normalize `location_country` itself is a separate, later project.
 *
 * No I/O: pure functions over an already-loaded `Gazetteer`, so this is
 * unit-testable without a corpus round-trip (corpus-values.ts still gates
 * every candidate this produces before it becomes a real filter).
 */
import type { Gazetteer, GazetteerCountry } from "./gazetteer";
import type { PlaceCandidate } from "./resolve-place";

/**
 * ISO2 countries whose subdivision expansion is worth the added candidate
 * count. Data, not code — extend by adding a code here. Verify a newly-added
 * country's admin1 count + `MAX_CITIES_PER_COUNTRY` stays comfortably under
 * Meili's ~100 IN-list guidance (no GeoNames admin1 list today exceeds ~60).
 */
export const SUBDIVISION_EXPANSION_COUNTRIES: ReadonlySet<string> = new Set(["CA", "US", "GB", "AU", "DE", "IN"]);

/** Cap on how many of a country's most-populous cities become candidates —
 *  admin1 regions have no cap (the largest list, the US's 51, is still cheap). */
export const MAX_CITIES_PER_COUNTRY = 15;

/**
 * True when `name` can't safely be claimed as one of `countryCode`'s own
 * subdivisions because a DIFFERENT country already owns that exact name —
 * either as a country itself ("Georgia") or as another country's admin1
 * ("Victoria" — Australia's state, "Florida"/"Montana" — Uruguay/Puerto
 * Rico's and Bulgaria's admin1 names respectively). Applies to both admin1
 * and city candidates: a bare `location_country = "<name>"` OR-term would
 * otherwise also match that other country's real postings.
 */
function claimedElsewhere(name: string, countryCode: string, gazetteer: Gazetteer): boolean {
  const key = name.toLowerCase();
  if (gazetteer.countriesByName.has(key)) return true;
  const admins = gazetteer.admin1ByName.get(key);
  return Boolean(admins?.some((a) => a.countryCode !== countryCode));
}

/**
 * True when a same-named city in a DIFFERENT country outweighs this one by
 * population — the same population tiebreak `resolveCity` already uses for
 * worldwide name ambiguity (resolve-place.ts), applied here so only the
 * more-populous country's expansion ever claims a shared city name (keeps
 * London/UK, drops London/Ontario). City candidates only — admin1 names
 * don't have this kind of cross-country population collision in practice.
 */
function outweighedElsewhere(name: string, countryCode: string, population: number, gazetteer: Gazetteer): boolean {
  const cities = gazetteer.citiesByName.get(name.toLowerCase());
  return Boolean(cities?.some((c) => c.countryCode !== countryCode && c.population > population));
}

/**
 * `country`'s admin1 regions and top cities as additional `location_country`
 * candidates — see the module doc. Empty for any country not in
 * `SUBDIVISION_EXPANSION_COUNTRIES`. Unvalidated (like every other
 * `PlaceCandidate` this module's caller produces) — corpus-values.ts is what
 * turns these into real filters.
 */
export function subdivisionCandidates(country: GazetteerCountry, gazetteer: Gazetteer): PlaceCandidate[] {
  if (!SUBDIVISION_EXPANSION_COUNTRIES.has(country.iso2)) return [];

  const seen = new Set<string>();
  const out: PlaceCandidate[] = [];

  for (const admin1 of gazetteer.admin1ByCountry.get(country.iso2) ?? []) {
    if (claimedElsewhere(admin1.name, country.iso2, gazetteer)) continue;
    const key = admin1.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field: "location_country", value: admin1.name });
  }

  const citiesByPopulation = [...(gazetteer.citiesByCountry.get(country.iso2) ?? [])].sort(
    (a, b) => b.population - a.population,
  );
  let kept = 0;
  for (const city of citiesByPopulation) {
    if (kept >= MAX_CITIES_PER_COUNTRY) break;
    if (claimedElsewhere(city.name, country.iso2, gazetteer)) continue;
    if (outweighedElsewhere(city.name, country.iso2, city.population, gazetteer)) continue;
    const key = city.name.toLowerCase();
    if (seen.has(key)) continue; // already an admin1 candidate — no literal duplicate value
    seen.add(key);
    out.push({ field: "location_country", value: city.name });
    kept += 1;
  }

  return out;
}
