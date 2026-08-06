/**
 * In-memory gazetteer index — city/admin1(state,province)/country name
 * lookups + the same-country radius-neighbor search `resolve-place.ts` uses
 * to expand "Toronto" into "Toronto, Markham, Mississauga, Brampton...".
 *
 * Backing data: `data/geo/gazetteer.json`, built by
 * `scripts/build-gazetteer.mjs` from GeoNames.org's free dumps
 * (cities5000 + admin1CodesASCII + countryInfo, CC BY 4.0 —
 * https://www.geonames.org/ — see README.md's "Location data" section for
 * full attribution). Re-run the build script to refresh; the artifact is
 * committed, not fetched at runtime.
 *
 * `buildGazetteerIndex` is pure (data in, lookup maps out) so tests build
 * small fixture gazetteers instead of loading the full ~70k-city artifact —
 * fast, deterministic, and immune to the committed data drifting under a
 * future GeoNames refresh. `loadGazetteer` is the one I/O wrapper (a bundled
 * JSON import, memoized) production code calls.
 */
import gazetteerJson from "../../../data/geo/gazetteer.json";

/** [asciiName, nativeNameOrNull, lat, lng, countryCode, admin1CodeOrNull, population] */
type CityRow = [string, string | null, number, number, string, string | null, number];
/** [countryCode, admin1Code, name] */
type Admin1Row = [string, string, string];
/** [iso2, iso3, name] */
type CountryRow = [string, string, string];

export interface GazetteerData {
  countries: CountryRow[];
  admin1: Admin1Row[];
  cities: CityRow[];
}

export interface GazetteerCountry {
  iso2: string;
  iso3: string;
  name: string;
}

export interface GazetteerAdmin1 {
  countryCode: string;
  code: string;
  name: string;
}

export interface GazetteerCity {
  name: string;
  nativeName: string | null;
  lat: number;
  lng: number;
  countryCode: string;
  admin1Code: string | null;
  population: number;
}

export interface Gazetteer {
  countriesByName: Map<string, GazetteerCountry>;
  countriesByIso2: Map<string, GazetteerCountry>;
  countriesByIso3: Map<string, GazetteerCountry>;
  admin1ByName: Map<string, GazetteerAdmin1[]>;
  citiesByName: Map<string, GazetteerCity[]>;
  citiesByCountry: Map<string, GazetteerCity[]>;
  /** Longest name (in words) actually present, so the query scanner
   *  (resolve-place.ts) knows how far to look — data-driven, not a guess. */
  maxGram: number;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).length;
}

/** Pure: raw gazetteer rows -> the lookup maps the resolver walks. */
export function buildGazetteerIndex(data: GazetteerData): Gazetteer {
  const countriesByName = new Map<string, GazetteerCountry>();
  const countriesByIso2 = new Map<string, GazetteerCountry>();
  const countriesByIso3 = new Map<string, GazetteerCountry>();
  const admin1ByName = new Map<string, GazetteerAdmin1[]>();
  const citiesByName = new Map<string, GazetteerCity[]>();
  const citiesByCountry = new Map<string, GazetteerCity[]>();
  let maxGram = 1;

  for (const [iso2, iso3, name] of data.countries) {
    const country: GazetteerCountry = { iso2, iso3, name };
    countriesByName.set(name.toLowerCase(), country);
    countriesByIso2.set(iso2.toUpperCase(), country);
    countriesByIso3.set(iso3.toUpperCase(), country);
    maxGram = Math.max(maxGram, wordCount(name));
  }

  for (const [countryCode, code, name] of data.admin1) {
    const admin1: GazetteerAdmin1 = { countryCode, code, name };
    const key = name.toLowerCase();
    const list = admin1ByName.get(key) ?? [];
    list.push(admin1);
    admin1ByName.set(key, list);
    maxGram = Math.max(maxGram, wordCount(name));
  }

  for (const [name, nativeName, lat, lng, countryCode, admin1Code, population] of data.cities) {
    const city: GazetteerCity = { name, nativeName, lat, lng, countryCode, admin1Code, population };
    for (const label of nativeName && nativeName !== name ? [name, nativeName] : [name]) {
      const key = label.toLowerCase();
      const list = citiesByName.get(key) ?? [];
      list.push(city);
      citiesByName.set(key, list);
      maxGram = Math.max(maxGram, wordCount(label));
    }
    const byCountry = citiesByCountry.get(countryCode) ?? [];
    byCountry.push(city);
    citiesByCountry.set(countryCode, byCountry);
  }

  // Bound the scanner's per-token work regardless of how long a real-world
  // name gets ("Dadra and Nagar Haveli and Daman and Diu" is 8 words) —
  // this is a performance cap on the search, not a matching rule.
  return {
    countriesByName,
    countriesByIso2,
    countriesByIso3,
    admin1ByName,
    citiesByName,
    citiesByCountry,
    maxGram: Math.min(maxGram, 8),
  };
}

let cached: Gazetteer | null = null;

/** The committed gazetteer, indexed once per server instance. */
export function loadGazetteer(): Gazetteer {
  if (!cached) cached = buildGazetteerIndex(gazetteerJson as unknown as GazetteerData);
  return cached;
}
