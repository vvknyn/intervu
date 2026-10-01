/**
 * Which country a job's free-text location names, read against the
 * gazetteer. "More like this" (jobs/related-country.ts) searched the whole
 * world whenever the text wasn't a plain "City, State" or "City, Country"
 * (2026-09-30): "NYC Office" listed roles in Egypt and Sydney, "Utah County
 * Administration Building" roles in Tel Aviv and Athens, and
 * "CA, Oakville 1, Office" read as California.
 *
 * Each comma piece is scanned longest phrase first, and a phrase keeps every
 * reading the gazetteer has for it: a country, a state or province, or
 * cities with their populations. A whole piece that is a two-letter code in
 * capitals ("CA", "TX", "ON") reads as a country code, a US state code and a
 * Canadian province code at once. Two answers come out:
 *
 * - `paired`: a place and the state or country it sits in, both named and
 *   nested in the gazetteer. "Oakville" beside "CA" is Canada (Canada has an
 *   Oakville, California has none), "Paris, TX" is the US, "London, Ontario"
 *   is Canada. The strongest evidence a location can give.
 * - `named`: otherwise, the country the most administrative phrase points to.
 *   A phrase counts only when one country clearly outweighs every other
 *   reading of it: "London" is England's 9M, not Ontario's 422k, and
 *   "Manchester" is England's city, not Jamaica's parish, while "Cambridge"
 *   and a bare "CA" are toss-ups that count for nothing.
 *
 * Both are null when the text names nothing placeable, such as
 * "Merseyside" (a county; the gazetteer holds countries, states and cities
 * only) or "Head Office".
 */
import type { Gazetteer } from "./gazetteer";
import { isPlaceGuardWord, resolvePlacePhrase } from "./resolve-place";

type Reading =
  | { kind: "country"; iso2: string }
  | { kind: "admin1"; iso2: string; admin1: string }
  | { kind: "city"; iso2: string; admin1: string | null; population: number };

interface Phrase {
  readings: Reading[];
  /** A whole piece that was a bare two-letter code. */
  code: boolean;
}

export interface LocationTextCountry {
  paired: string | null;
  named: string | null;
}

/** A phrase's leading country must outweigh the next country's reading by this much. */
const DOMINANCE = 3;

/** ...and weigh at least this much: a "Downtown" of 12k people names no country. */
const MIN_WEIGHT = 50_000;

/** Canadian postal codes for provinces → GeoNames admin1 codes, which are
 *  numeric for Canada (the US's are the postal codes themselves). */
const CA_PROVINCE_CODES: Readonly<Record<string, string>> = {
  AB: "01", BC: "02", MB: "03", NB: "04", NL: "05", NS: "07", ON: "08",
  PE: "09", QC: "10", SK: "11", YT: "12", NT: "13", NU: "14",
};

const PIECE_SEPARATOR = /[,;|/()·•]|\s[-–—]\s/;

/** Words of a generic region name ("North West", "West Coast", "Central
 *  Region"): real provinces in South Africa, New Zealand or Malawi, but in a
 *  job's location they mean a part of the job's own country. */
const GENERIC_REGION_WORDS = new Set([
  "north", "south", "east", "west", "northern", "southern", "eastern", "western", "central", "middle",
  "the", "coast", "region", "district", "province", "department", "capital", "national",
]);

const KIND_RANK: Record<Reading["kind"], number> = { country: 0, admin1: 1, city: 2 };

interface Weights {
  country: Map<string, number>;
  admin1: Map<string, number>;
}

const weightsCache = new WeakMap<Gazetteer, Weights>();

/** Population summed over each country's and each state's cities, built once per gazetteer. */
function weights(gazetteer: Gazetteer): Weights {
  let w = weightsCache.get(gazetteer);
  if (!w) {
    w = { country: new Map(), admin1: new Map() };
    for (const [iso2, cities] of gazetteer.citiesByCountry) {
      for (const city of cities) {
        w.country.set(iso2, (w.country.get(iso2) ?? 0) + city.population);
        if (!city.admin1Code) continue;
        const key = `${iso2}:${city.admin1Code}`;
        w.admin1.set(key, (w.admin1.get(key) ?? 0) + city.population);
      }
    }
    weightsCache.set(gazetteer, w);
  }
  return w;
}

function readingWeight(r: Reading, w: Weights): number {
  if (r.kind === "city") return r.population;
  if (r.kind === "admin1") return w.admin1.get(`${r.iso2}:${r.admin1}`) ?? 0;
  // A country named outright counts even when the gazetteer lists few of its towns.
  return Math.max(w.country.get(r.iso2) ?? 0, MIN_WEIGHT);
}

function codeReadings(code: string, gazetteer: Gazetteer): Reading[] {
  const out: Reading[] = [];
  const iso2 = code === "UK" ? "GB" : code;
  if (gazetteer.countriesByIso2.has(iso2)) out.push({ kind: "country", iso2 });
  if (gazetteer.admin1ByCountry.get("US")?.some((a) => a.code === code)) out.push({ kind: "admin1", iso2: "US", admin1: code });
  const province = CA_PROVINCE_CODES[code];
  if (province) out.push({ kind: "admin1", iso2: "CA", admin1: province });
  return out;
}

function phraseReadings(words: string[], gazetteer: Gazetteer): Reading[] {
  const raw = words.join(" ");
  if (words.length === 1 && /^[A-Z]{3}$/.test(raw)) {
    const byIso3 = gazetteer.countriesByIso3.get(raw);
    if (byIso3) return [{ kind: "country", iso2: byIso3.iso2 }];
  }
  const name = raw.toLowerCase();
  if (name.length < 3 || /\d/.test(name)) return [];
  if (words.length === 1 && isPlaceGuardWord(name)) return [];
  const out: Reading[] = [];
  const country = gazetteer.countriesByName.get(name);
  if (country) out.push({ kind: "country", iso2: country.iso2 });
  if (!name.split(" ").every((w) => GENERIC_REGION_WORDS.has(w))) {
    for (const a of gazetteer.admin1ByName.get(name) ?? []) out.push({ kind: "admin1", iso2: a.countryCode, admin1: a.code });
  }
  for (const c of gazetteer.citiesByName.get(name) ?? []) {
    out.push({ kind: "city", iso2: c.countryCode, admin1: c.admin1Code, population: c.population });
  }
  if (out.length > 0) return out;
  // Nicknames and old names the gazetteer doesn't index itself: "NYC", "Bangalore".
  const alias = resolvePlacePhrase(name, gazetteer, true, { radius: false });
  const canonical = alias?.entity.countryCode ? alias.entity.name : null;
  return canonical && canonical.toLowerCase() !== name ? phraseReadings(canonical.split(" "), gazetteer) : [];
}

function readPhrases(text: string, gazetteer: Gazetteer): Phrase[] {
  const phrases: Phrase[] = [];
  // Leading codes joined by hyphens are pieces of their own: "US-CA-San Francisco", "GB-London".
  const spaced = text.replace(/^(?:[A-Z]{2,3}-)+/, (codes) => codes.split("-").join(", "));
  for (const piece of spaced.split(PIECE_SEPARATOR)) {
    const trimmed = piece.trim();
    if (/^[A-Z]{2}$/.test(trimmed)) {
      const readings = codeReadings(trimmed, gazetteer);
      if (readings.length > 0) phrases.push({ readings, code: true });
      continue;
    }
    const words = trimmed
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean);
    let i = 0;
    while (i < words.length) {
      let consumed = 1;
      for (let len = Math.min(gazetteer.maxGram, words.length - i); len >= 1; len--) {
        const readings = phraseReadings(words.slice(i, i + len), gazetteer);
        if (readings.length === 0) continue;
        phrases.push({ readings, code: false });
        consumed = len;
        break;
      }
      i += consumed;
    }
  }
  return phrases;
}

/** Whether `inner` lies inside `outer`: a city or state in its country, a city in its state. */
function nests(inner: Reading, outer: Reading): boolean {
  if (inner.kind === "country" || outer.kind === "city" || inner.iso2 !== outer.iso2) return false;
  return outer.kind === "country" || inner.admin1 === outer.admin1;
}

function pairedCountry(phrases: Phrase[]): string | null {
  const voted = new Set<string>();
  for (const inner of phrases) {
    for (const outer of phrases) {
      if (inner === outer) continue;
      const countries = new Set<string>();
      for (const a of inner.readings) for (const b of outer.readings) if (nests(a, b)) countries.add(a.iso2);
      // "Ontario, CA" nests both ways (the province in Canada, the Californian city in its state).
      if (countries.size === 1) voted.add([...countries][0]!);
    }
  }
  return voted.size === 1 ? [...voted][0]! : null;
}

/** The one country a phrase clearly names, and how administrative its reading is. */
function phraseCountry(phrase: Phrase, w: Weights): { iso2: string; rank: number } | null {
  const best = new Map<string, { weight: number; rank: number }>();
  for (const r of phrase.readings) {
    const weight = readingWeight(r, w);
    const seen = best.get(r.iso2);
    if (!seen || weight > seen.weight) best.set(r.iso2, { weight, rank: KIND_RANK[r.kind] });
  }
  // A bare code with two meanings ("CA", "IN", "DE") picks neither.
  if (phrase.code && best.size > 1) return null;
  const ranked = [...best].sort((a, b) => b[1].weight - a[1].weight);
  const [top, next] = ranked;
  if (!top || top[1].weight < MIN_WEIGHT) return null;
  if (next && top[1].weight < DOMINANCE * next[1].weight) return null;
  return { iso2: top[0], rank: top[1].rank };
}

function namedCountry(phrases: Phrase[], w: Weights): string | null {
  const decided = phrases.map((p) => phraseCountry(p, w)).filter((d): d is { iso2: string; rank: number } => d !== null);
  if (decided.length === 0) return null;
  const rank = Math.min(...decided.map((d) => d.rank));
  const countries = new Set(decided.filter((d) => d.rank === rank).map((d) => d.iso2));
  return countries.size === 1 ? [...countries][0]! : null;
}

export function readLocationCountry(text: string | null | undefined, gazetteer: Gazetteer): LocationTextCountry {
  const phrases = readPhrases(text ?? "", gazetteer);
  if (phrases.length === 0) return { paired: null, named: null };
  return { paired: pairedCountry(phrases), named: namedCountry(phrases, weights(gazetteer)) };
}
