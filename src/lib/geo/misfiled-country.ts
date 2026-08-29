/**
 * Is this corpus value a COUNTRY name misfiled under a narrower location
 * facet?
 *
 * ATSes stuff country names into their city/state columns, and the location
 * typeahead mirrors facet values, so the junk renders as a selectable trap.
 * Measured on prod 2026-08-29 (the "just 2 results?" report): typing "Canada"
 * offered a CITIES · Canada row (31 postings — `location_city = "Canada"` is
 * a real corpus value) directly under the honest Countries · Canada row
 * (66,010). Picking the city row filters the exact literal and returns 2
 * results inside the default 30 days, under a relaxation banner. The same
 * trap at scale: Cities · United States 343 and States · United States 238
 * beside Countries · United States 1,226,099; States · Germany 904;
 * States · India 97.
 *
 * The rule is two data-table lookups over the gazetteer, never a list of
 * banned strings:
 *
 *   suppress from the CITY facet   iff  country name AND NOT a city name
 *   suppress from the STATE facet  iff  country name AND NOT an admin1 name
 *
 * The second lookup is what keeps real places alive — the same reason
 * `isMalformedLocationValue` is positive-evidence-only. "Georgia" is US.GA
 * in admin1, so States · Georgia (8,148 on prod) still renders; "Mexico" is
 * a city in Missouri and an admin1 (Estado de México), so both of its
 * narrower rows survive. A value the gazetteer doesn't know as a country at
 * all is untouched, whatever it is.
 *
 * Country NAMES only, deliberately not iso2/iso3 codes: the corpus value
 * "CA" means California, and iso2 CA is Canada — code matching would
 * suppress every US-state abbreviation that collides with some country's
 * code. Codes never reach the corpus as a country spelling anyway; names do.
 *
 * Matching folds both sides with `foldForMatch` — the same transform the
 * suggestion merge itself groups by, so what this predicate judges is
 * exactly the row the dropdown would have shown. The protective lookups use
 * the gazetteer maps' own lowercase keys: a folded value is pure ASCII, and
 * `citiesByName`/`admin1ByName` always carry an ASCII key for every entry
 * (GeoNames asciiName / admin1CodesASCII), so an ASCII probe cannot miss a
 * place that exists merely because its display spelling is accented.
 *
 * A country name in the COUNTRY facet is correctly filed and never touched
 * here — picking that row commits `location_country`, which runs the full
 * gazetteer pipeline and delivers the broad result the searcher meant.
 */
import { foldForMatch } from "@/lib/geo/corpus-values";
import type { Gazetteer } from "@/lib/geo/gazetteer";
import type { LocationField } from "@/lib/geo/resolve-place";

/** Folded country-name set, built once per gazetteer instance (a WeakMap so
 *  test fixtures index independently of the production singleton). */
const foldedCountryNames = new WeakMap<Gazetteer, Set<string>>();

function countryNames(gazetteer: Gazetteer): Set<string> {
  let names = foldedCountryNames.get(gazetteer);
  if (!names) {
    names = new Set([...gazetteer.countriesByName.values()].map((c) => foldForMatch(c.name)));
    foldedCountryNames.set(gazetteer, names);
  }
  return names;
}

export function isMisfiledCountryName(
  field: LocationField,
  value: string,
  gazetteer: Gazetteer,
): boolean {
  if (field === "location_country") return false;
  const folded = foldForMatch(value);
  if (!folded || !countryNames(gazetteer).has(folded)) return false;
  return field === "location_city"
    ? !gazetteer.citiesByName.has(folded)
    : !gazetteer.admin1ByName.has(folded);
}
