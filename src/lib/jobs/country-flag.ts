import { classifyCountryValue } from "@/lib/jobs/country-classification";

/**
 * `location_country` → regional-indicator flag emoji, for the Himalayas-
 * style flag chip on SERP job cards and the JobDetail facts row.
 *
 * Pure, DOM-free. Keyed on the SAME canonical country names
 * country-classification.ts already validates `location_country` facet
 * values against (`classifyCountryValue`, reused rather than re-derived —
 * one country table, not two) — every name/alias/casing that module
 * recognizes as a real country resolves to a flag here for free. Anything
 * that doesn't match a canonical name falls through to a generic ISO-3166
 * alpha-2 passthrough (regional-indicator code-point math), so a raw 2-letter
 * code in the data never needs its own table entry.
 *
 * Canonical-name lookup runs BEFORE the ISO-2 passthrough on purpose: a
 * colloquial 2-letter-ish value like "UK" is a known alias for
 * "United Kingdom" (see country-classification's COUNTRY_ALIASES), whose
 * real ISO-3166 code is GB, not UK — routing through classification first
 * gets the correct flag instead of a passthrough guess.
 */

/** Canonical country name (country-classification.ts's ISO_COUNTRY_NAMES) →
 *  ISO 3166-1 alpha-2 code. Kosovo uses "XK", the widely-used unofficial
 *  code (ISO has not assigned one) — same value CLDR/most flag-emoji fonts
 *  render as the Kosovo flag. */
const CANONICAL_TO_ISO2: Record<string, string> = {
  Afghanistan: "AF",
  Albania: "AL",
  Algeria: "DZ",
  Andorra: "AD",
  Angola: "AO",
  "Antigua and Barbuda": "AG",
  Argentina: "AR",
  Armenia: "AM",
  Australia: "AU",
  Austria: "AT",
  Azerbaijan: "AZ",
  Bahamas: "BS",
  Bahrain: "BH",
  Bangladesh: "BD",
  Barbados: "BB",
  Belarus: "BY",
  Belgium: "BE",
  Belize: "BZ",
  Benin: "BJ",
  Bhutan: "BT",
  Bolivia: "BO",
  "Bosnia and Herzegovina": "BA",
  Botswana: "BW",
  Brazil: "BR",
  Brunei: "BN",
  Bulgaria: "BG",
  "Burkina Faso": "BF",
  Burundi: "BI",
  "Cabo Verde": "CV",
  Cambodia: "KH",
  Cameroon: "CM",
  Canada: "CA",
  "Central African Republic": "CF",
  Chad: "TD",
  Chile: "CL",
  China: "CN",
  Colombia: "CO",
  Comoros: "KM",
  Congo: "CG",
  "Democratic Republic of the Congo": "CD",
  "Costa Rica": "CR",
  Croatia: "HR",
  Cuba: "CU",
  Cyprus: "CY",
  Czechia: "CZ",
  Denmark: "DK",
  Djibouti: "DJ",
  Dominica: "DM",
  "Dominican Republic": "DO",
  Ecuador: "EC",
  Egypt: "EG",
  "El Salvador": "SV",
  "Equatorial Guinea": "GQ",
  Eritrea: "ER",
  Estonia: "EE",
  Eswatini: "SZ",
  Ethiopia: "ET",
  Fiji: "FJ",
  Finland: "FI",
  France: "FR",
  Gabon: "GA",
  Gambia: "GM",
  Georgia: "GE",
  Germany: "DE",
  Ghana: "GH",
  Greece: "GR",
  Grenada: "GD",
  Guatemala: "GT",
  Guinea: "GN",
  "Guinea-Bissau": "GW",
  Guyana: "GY",
  Haiti: "HT",
  Honduras: "HN",
  "Hong Kong": "HK",
  Hungary: "HU",
  Iceland: "IS",
  India: "IN",
  Indonesia: "ID",
  Iran: "IR",
  Iraq: "IQ",
  Ireland: "IE",
  Israel: "IL",
  Italy: "IT",
  "Ivory Coast": "CI",
  Jamaica: "JM",
  Japan: "JP",
  Jordan: "JO",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Kiribati: "KI",
  Kosovo: "XK",
  Kuwait: "KW",
  Kyrgyzstan: "KG",
  Laos: "LA",
  Latvia: "LV",
  Lebanon: "LB",
  Lesotho: "LS",
  Liberia: "LR",
  Libya: "LY",
  Liechtenstein: "LI",
  Lithuania: "LT",
  Luxembourg: "LU",
  Madagascar: "MG",
  Malawi: "MW",
  Malaysia: "MY",
  Maldives: "MV",
  Mali: "ML",
  Malta: "MT",
  "Marshall Islands": "MH",
  Mauritania: "MR",
  Mauritius: "MU",
  Mexico: "MX",
  Micronesia: "FM",
  Moldova: "MD",
  Monaco: "MC",
  Mongolia: "MN",
  Montenegro: "ME",
  Morocco: "MA",
  Mozambique: "MZ",
  Myanmar: "MM",
  Namibia: "NA",
  Nauru: "NR",
  Nepal: "NP",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Nicaragua: "NI",
  Niger: "NE",
  Nigeria: "NG",
  "North Korea": "KP",
  "North Macedonia": "MK",
  Norway: "NO",
  Oman: "OM",
  Pakistan: "PK",
  Palau: "PW",
  Palestine: "PS",
  Panama: "PA",
  "Papua New Guinea": "PG",
  Paraguay: "PY",
  Peru: "PE",
  Philippines: "PH",
  Poland: "PL",
  Portugal: "PT",
  Qatar: "QA",
  Romania: "RO",
  Russia: "RU",
  Rwanda: "RW",
  "Saint Kitts and Nevis": "KN",
  "Saint Lucia": "LC",
  "Saint Vincent and the Grenadines": "VC",
  Samoa: "WS",
  "San Marino": "SM",
  "Sao Tome and Principe": "ST",
  "Saudi Arabia": "SA",
  Senegal: "SN",
  Serbia: "RS",
  Seychelles: "SC",
  "Sierra Leone": "SL",
  Singapore: "SG",
  Slovakia: "SK",
  Slovenia: "SI",
  "Solomon Islands": "SB",
  Somalia: "SO",
  "South Africa": "ZA",
  "South Korea": "KR",
  "South Sudan": "SS",
  Spain: "ES",
  "Sri Lanka": "LK",
  Sudan: "SD",
  Suriname: "SR",
  Sweden: "SE",
  Switzerland: "CH",
  Syria: "SY",
  Taiwan: "TW",
  Tajikistan: "TJ",
  Tanzania: "TZ",
  Thailand: "TH",
  "Timor-Leste": "TL",
  Togo: "TG",
  Tonga: "TO",
  "Trinidad and Tobago": "TT",
  Tunisia: "TN",
  Turkey: "TR",
  Turkmenistan: "TM",
  Tuvalu: "TV",
  Uganda: "UG",
  Ukraine: "UA",
  "United Arab Emirates": "AE",
  "United Kingdom": "GB",
  "United States": "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
  Vanuatu: "VU",
  "Vatican City": "VA",
  Venezuela: "VE",
  Vietnam: "VN",
  Yemen: "YE",
  Zambia: "ZM",
  Zimbabwe: "ZW",
};

const ISO2_PATTERN = /^[A-Za-z]{2}$/;

/** ISO-3166 alpha-2 → flag emoji via regional-indicator code-point math
 *  (each letter maps to U+1F1E6 + its A-Z offset). `null` for anything that
 *  isn't exactly two letters. */
function regionalIndicatorFlag(iso2: string): string | null {
  if (!ISO2_PATTERN.test(iso2)) return null;
  const codePoints = iso2
    .toUpperCase()
    .split("")
    .map((letter) => 0x1f1e6 + (letter.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

/**
 * Map a raw `location_country` value to a flag emoji, or `null` when it
 * can't be resolved — callers render the location chip without a flag
 * rather than a broken/placeholder glyph.
 */
export function countryToFlag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const classification = classifyCountryValue(trimmed);
  if (classification.kind === "country") {
    const iso2 = CANONICAL_TO_ISO2[classification.canonical];
    if (iso2) return regionalIndicatorFlag(iso2);
  }

  // Not a recognized country name/alias — try it as a raw ISO-2 code
  // (e.g. a value the corpus already stores as "DE" rather than "Germany").
  return regionalIndicatorFlag(trimmed);
}
