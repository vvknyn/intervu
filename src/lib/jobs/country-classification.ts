/**
 * `location_country` facet-value classification for the /trends "Top hiring
 * countries" section.
 *
 * Verified live 2026-07-29: the `location_country` facet is polluted with
 * city/region/building names and remote-work sentinels as raw facet
 * values — e.g. "London" (4,952), "San Francisco" (4,146), "Berlin" (2,500),
 * "Santa Clara" (2,148), "Bengaluru", "Multiple Locations", "Remote - Us",
 * "Cleveland Clinic Main Campus". Rather than special-case each offending
 * value (a job never done, since the pipeline can emit new junk anytime),
 * this module validates every raw value against a static ISO-3166-ish
 * English-name table + a small alias set for known synonyms (UK/United
 * Kingdom, USA/United States, …). Anything that doesn't match either rolls
 * into one `UNCLASSIFIED_LABEL` bucket — see `rollupCountryDistribution`.
 *
 * Pure, DOM-free — unit-testable without a network call.
 */

/**
 * Common English short names for the ~195 ISO 3166-1 countries/territories
 * that show up as `location_country` values in job postings (includes
 * Hong Kong and Taiwan, which the corpus reports as distinct location
 * values regardless of political status). Canonical casing — this is what
 * renders in the UI and what gets sent back in the search filter.
 */
const ISO_COUNTRY_NAMES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda",
  "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
  "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso",
  "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic",
  "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Democratic Republic of the Congo",
  "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea",
  "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia",
  "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia",
  "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jordan",
  "Kazakhstan", "Kenya", "Kiribati", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
  "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
  "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar",
  "Romania", "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland",
  "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga",
  "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine",
  "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
] as const;

/** lowercase name → canonical name, for O(1) case-insensitive exact match. */
const CANONICAL_BY_LOWER = new Map<string, string>(
  ISO_COUNTRY_NAMES.map((name) => [name.toLowerCase(), name]),
);

/**
 * Known synonyms for a canonical name above — abbreviations, alternate
 * spellings, and other-language short forms actually seen in ATS location
 * data. Deliberately NOT a typo-correction table (e.g. "Columbia", a
 * misspelling of "Colombia" seen live, is NOT aliased here — that would be
 * guessing at a single value's intent rather than recognizing a genuine
 * synonym, and it's also a real place name in its own right). Keys are
 * lowercase; extend this table, never the canonical list, when a new
 * legitimate synonym turns up.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  "usa": "United States",
  "u.s.a.": "United States",
  "us": "United States",
  "u.s.": "United States",
  "united states of america": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  "britain": "United Kingdom",
  "uae": "United Arab Emirates",
  "russian federation": "Russia",
  "republic of korea": "South Korea",
  "korea, south": "South Korea",
  "korea, republic of": "South Korea",
  "dprk": "North Korea",
  "korea, north": "North Korea",
  "ivory coast": "Ivory Coast",
  "cote d'ivoire": "Ivory Coast",
  "côte d'ivoire": "Ivory Coast",
  "czech republic": "Czechia",
  "swaziland": "Eswatini",
  "burma": "Myanmar",
  "cape verde": "Cabo Verde",
  "macedonia": "North Macedonia",
  "holland": "Netherlands",
  "the netherlands": "Netherlands",
  "holy see": "Vatican City",
  "bosnia": "Bosnia and Herzegovina",
  "dr congo": "Democratic Republic of the Congo",
  "drc": "Democratic Republic of the Congo",
  "congo-kinshasa": "Democratic Republic of the Congo",
  "congo-brazzaville": "Congo",
  "east timor": "Timor-Leste",
  "viet nam": "Vietnam",
  // Endonyms a company name can carry ("intermedix Österreich"), beyond the English names above.
  "österreich": "Austria",
  "osterreich": "Austria",
  "deutschland": "Germany",
  "schweiz": "Switzerland",
  "suisse": "Switzerland",
  "svizzera": "Switzerland",
  "españa": "Spain",
  "italia": "Italy",
  "nederland": "Netherlands",
  "belgique": "Belgium",
  "belgië": "Belgium",
  "polska": "Poland",
  "sverige": "Sweden",
  "norge": "Norway",
  "danmark": "Denmark",
  "suomi": "Finland",
  "brasil": "Brazil",
  "méxico": "Mexico",
  "türkiye": "Turkey",
};

export interface CountryClassification {
  kind: "country" | "unclassified";
  /** Canonical display name when `kind === "country"`; the trimmed raw
   *  value echoed back (for grouping only, never rendered as a country)
   *  when `kind === "unclassified"`. */
  canonical: string;
}

/** Pure: classify one raw `location_country` facet value. */
export function classifyCountryValue(raw: string): CountryClassification {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();
  const canonical = CANONICAL_BY_LOWER.get(key) ?? COUNTRY_ALIASES[key];
  return canonical ? { kind: "country", canonical } : { kind: "unclassified", canonical: trimmed };
}

/** The always-last, never-linkable rollup row for everything that isn't a
 *  recognized country (cities, regions, remote sentinels, building names). */
export const UNCLASSIFIED_LABEL = "Unclassified locations";

export interface CountryRollupRow {
  /** Canonical country name, or `UNCLASSIFIED_LABEL`. */
  country: string;
  /** Summed straight off Meilisearch's `facetDistribution`, which (unlike
   *  `totalHits`/`estimatedTotalHits`) is never subject to the
   *  `maxTotalHits` pagination cap — see corpus-count.ts. */
  count: number;
  /** The raw facet values that rolled into this row, so a caller can build
   *  a search filter that matches every alias variant at once. `undefined`
   *  for the Unclassified row — it has no single corpus value to filter by,
   *  so it never links into search. */
  rawValues: string[] | undefined;
}

/**
 * Roll a live `location_country` facet distribution up into canonical
 * countries (merging alias variants — e.g. "UK" + "United Kingdom" become
 * one row) plus one trailing Unclassified row for everything else. Sorted
 * by count, descending; Unclassified is always last regardless of its size.
 */
export function rollupCountryDistribution(
  distribution: Record<string, number> | undefined,
): CountryRollupRow[] {
  const byCanonical = new Map<string, { count: number; rawValues: string[] }>();
  let unclassifiedCount = 0;

  for (const [raw, count] of Object.entries(distribution ?? {})) {
    const classification = classifyCountryValue(raw);
    if (classification.kind === "unclassified") {
      unclassifiedCount += count;
      continue;
    }
    const entry = byCanonical.get(classification.canonical) ?? { count: 0, rawValues: [] };
    entry.count += count;
    entry.rawValues.push(raw);
    byCanonical.set(classification.canonical, entry);
  }

  const rows: CountryRollupRow[] = Array.from(byCanonical.entries())
    .map(([country, { count, rawValues }]) => ({ country, count, rawValues }))
    .sort((a, b) => b.count - a.count);

  if (unclassifiedCount > 0) {
    rows.push({ country: UNCLASSIFIED_LABEL, count: unclassifiedCount, rawValues: undefined });
  }
  return rows;
}
