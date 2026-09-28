import type { PublicJob } from "./types";
import { toValueArray } from "./types";

/**
 * Read-path trust corrections for Meili documents — domain affiliation,
 * salary currency, and multi-zone salary bands inferred from posting text.
 * Applied at the Meili→wire boundary (`normalizePublicJob`). Upstream
 * jobs-sync may still write bad values; the Contabo repair script backfills
 * live Meili docs.
 *
 * Extend `BRAND_AFFILIATIONS` when prod QA surfaces a verified wrong→right
 * pair (brand match + country context + foreign domain). Do not invent mappings.
 */

/** Country-specific TLD suffixes that clearly indicate a non-Canadian site. */
const FOREIGN_COUNTRY_TLD_SUFFIXES = [
  ".co.uk",
  ".uk",
  ".de",
  ".fr",
  ".ie",
  ".au",
  ".nz",
  ".jp",
  ".in",
  ".br",
  ".mx",
  ".es",
  ".it",
  ".nl",
  ".se",
  ".no",
  ".dk",
  ".fi",
  ".at",
  ".ch",
  ".be",
  ".pl",
  ".sg",
  ".hk",
  ".kr",
  ".za",
  ".ae",
  ".tr",
  ".ru",
  ".cn",
] as const;

/** Ambiguous global TLDs — never treated as "foreign" on their own. */
const AMBIGUOUS_TLD_SUFFIXES = [".com", ".ca", ".org", ".net"] as const;

type BrandAffiliation = {
  /** Human label for logs / repair-script output. */
  brand: string;
  brandPatterns: RegExp[];
  /** Known wrong domains keyed to this brand (lowercase, no scheme). */
  wrongDomains: string[];
  /** Canonical domain per country code when location/company implies that market. */
  regions: Partial<Record<"CA" | "US", string>>;
};

/**
 * Multi-national brands that ingest often keys to the wrong regional domain.
 * Add rows here only with a verified wrong→right pair from prod QA.
 */
const BRAND_AFFILIATIONS: BrandAffiliation[] = [
  {
    brand: "TD Bank (Toronto-Dominion)",
    brandPatterns: [/toronto-dominion/i, /\btd bank\b/i, /^td$/i, /\bthe td\b/i],
    wrongDomains: [
      "tddirectinvesting.co.uk",
      "td.co.uk",
      "tdbank.co.uk",
    ],
    regions: { CA: "td.com", US: "td.com" },
  },
];

const CANADA_COMPANY_SUFFIX = /\((?:canada|canadian)\)/i;
/** Legal names like "Fresenius Medical Care Canada" — not only "(Canada)" suffixes. */
const CANADA_COMPANY_WORD = /\b(?:canada|canadian)\b/i;

const SALARY_CONTEXT =
  /\b(salary|compensation|pay(?:\s+range)?|wage|remuneration|package|earning|income|annual(?:ly)?|hourly|base\s+pay|total\s+compensation)\b/gi;

const SALARY_AMOUNT =
  /\$[\d,]+(?:\.\d{2})?(?:\s*[–\-—]\s*\$[\d,]+(?:\.\d{2})?|\s*(?:to|-)\s*\$[\d,]+(?:\.\d{2})?)?/g;

type CurrencyMarker = { code: "CAD" | "USD" | "GBP" | "EUR"; patterns: RegExp[] };

const CURRENCY_MARKERS: CurrencyMarker[] = [
  {
    code: "CAD",
    patterns: [
      // No `i` flag: `(?![a-z])` must stay case-sensitive so "CADTD" matches
      // (uppercase T) while "cadence" does not. `\bCAD\b` misses the glue.
      /(?<![A-Za-z])CAD(?![a-z])/g,
      /\bCA\$|\bC\$(?=\d)|\bCanadian dollars?\b/gi,
    ],
  },
  { code: "USD", patterns: [/\bUSD\b|\bUS\$/gi] },
  { code: "GBP", patterns: [/\bGBP\b|£|\bpounds?(?:\s+sterling)?\b/gi] },
  { code: "EUR", patterns: [/\bEUR\b|€|\beuros?\b/gi] },
];

const SALARY_MARKER_WINDOW = 120;

/** True when the domain uses a country-specific TLD that is not .com/.ca/.org/.net. */
export function isForeignCountryTld(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d) return false;

  for (const suffix of AMBIGUOUS_TLD_SUFFIXES) {
    if (d === suffix.slice(1) || d.endsWith(suffix)) return false;
  }
  for (const suffix of FOREIGN_COUNTRY_TLD_SUFFIXES) {
    if (d === suffix.slice(1) || d.endsWith(suffix)) return true;
  }
  return false;
}

function normalizeDomain(domain: string | null | undefined): string {
  return (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function isCanadaLocationCountry(location_country: PublicJob["location_country"]): boolean {
  return toValueArray(location_country).some((c) => {
    const v = c.trim();
    return /^ca$/i.test(v) || /^canada$/i.test(v);
  });
}

function isUnitedStatesLocationCountry(
  location_country: PublicJob["location_country"],
): boolean {
  return toValueArray(location_country).some((c) => {
    const v = c.trim();
    return (
      /^us$/i.test(v) ||
      /^usa$/i.test(v) ||
      /^united states$/i.test(v) ||
      /^united states of america$/i.test(v)
    );
  });
}

/** Job is Canada-scoped when the company name or location_country says so. */
export function isCanadaJobContext(
  job: Pick<PublicJob, "company" | "location_country">,
): boolean {
  const company = job.company?.trim() ?? "";
  if (CANADA_COMPANY_SUFFIX.test(company)) return true;
  if (CANADA_COMPANY_WORD.test(company)) return true;
  return isCanadaLocationCountry(job.location_country);
}

/** Job is United-States-scoped when location_country says so. */
export function isUnitedStatesJobContext(
  job: Pick<PublicJob, "location_country">,
): boolean {
  return isUnitedStatesLocationCountry(job.location_country);
}

function matchesBrand(company: string | null | undefined, patterns: RegExp[]): boolean {
  const name = company?.trim() ?? "";
  if (!name) return false;
  return patterns.some((p) => p.test(name));
}

function findBrandAffiliation(
  company: string | null | undefined,
): BrandAffiliation | null {
  for (const entry of BRAND_AFFILIATIONS) {
    if (matchesBrand(company, entry.brandPatterns)) return entry;
  }
  return null;
}

/**
 * Known Canada + foreign-domain risks from the affiliation table — useful for
 * repair-script filters and ops spot-checks. Extend `BRAND_AFFILIATIONS` to
 * grow this list.
 */
export function listCanadaForeignDomainRisks(): Array<{
  brand: string;
  wrongDomains: string[];
  correctDomain: string;
}> {
  return BRAND_AFFILIATIONS.flatMap((entry) => {
    const correctDomain = entry.regions.CA;
    if (!correctDomain) return [];
    return [{ brand: entry.brand, wrongDomains: [...entry.wrongDomains], correctDomain }];
  });
}

/**
 * Return a corrected `company_domain` when Canada context + brand affiliation
 * indicate a foreign or known-wrong domain. Otherwise return the original
 * (including null).
 */
export function correctCompanyDomain(
  job: Pick<PublicJob, "company" | "company_domain" | "location_country">,
): string | null {
  const original = job.company_domain;
  const domain = normalizeDomain(original);
  if (!domain) return original ?? null;

  const isCanada = isCanadaJobContext(job);
  const isUnitedStates = isUnitedStatesJobContext(job);
  if (!isCanada && !isUnitedStates) return original ?? null;

  const affiliation = findBrandAffiliation(job.company);
  if (!affiliation) return original ?? null;

  const canonical = isCanada
    ? affiliation.regions.CA
    : isUnitedStates
      ? affiliation.regions.US
      : undefined;
  if (!canonical) return original ?? null;

  const isKnownWrong = affiliation.wrongDomains.includes(domain);
  const isForeign = isForeignCountryTld(domain);

  if (isKnownWrong || (isForeign && domain !== canonical)) {
    return canonical;
  }

  return original ?? null;
}

function salaryContextPositions(text: string): number[] {
  const positions: number[] = [];

  SALARY_CONTEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SALARY_CONTEXT.exec(text)) !== null) {
    positions.push(m.index);
  }

  SALARY_AMOUNT.lastIndex = 0;
  while ((m = SALARY_AMOUNT.exec(text)) !== null) {
    positions.push(m.index);
  }

  return positions;
}

/**
 * Detect an explicit salary currency from posting text. Returns null when no
 * unambiguous marker is present — never infers from location alone.
 */
export function detectSalaryCurrencyFromText(
  description: string | null | undefined,
): "CAD" | "USD" | "GBP" | "EUR" | null {
  const text = description?.trim();
  if (!text) return null;

  const contextPositions = salaryContextPositions(text);

  type Hit = { code: CurrencyMarker["code"]; distance: number; index: number };
  const hits: Hit[] = [];

  for (const marker of CURRENCY_MARKERS) {
    for (const pattern of marker.patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const index = m.index;
        let distance = Infinity;
        for (const pos of contextPositions) {
          distance = Math.min(distance, Math.abs(index - pos));
        }
        hits.push({ code: marker.code, distance, index });
      }
    }
  }

  if (hits.length === 0) return null;

  const bestByCode = new Map<CurrencyMarker["code"], Hit>();
  for (const hit of hits) {
    const prev = bestByCode.get(hit.code);
    if (!prev || hit.distance < prev.distance) {
      bestByCode.set(hit.code, hit);
    }
  }

  const ranked = [...bestByCode.values()].sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.index - b.index;
  });

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (
    runnerUp &&
    best.distance === runnerUp.distance &&
    best.code !== runnerUp.code &&
    best.distance !== Infinity
  ) {
    return null;
  }

  if (contextPositions.length > 0) {
    if (best.distance > SALARY_MARKER_WINDOW) {
      if (bestByCode.size === 1 && best.distance < 400) return best.code;
      return null;
    }
    return best.code;
  }

  // No salary context — only trust when exactly one explicit currency marker exists.
  if (bestByCode.size === 1) return best.code;
  return null;
}

/**
 * When posting text names a currency different from stored `salary_currency`,
 * return the text-derived code — even if `salary_min` / `salary_max` are null
 * (TD Canada docs often keep the amounts only in the description). Never
 * invents a currency from location alone.
 */
export function correctSalaryCurrency(
  job: Pick<PublicJob, "salary_min" | "salary_max" | "salary_currency" | "description">,
): string | null {
  const detected = detectSalaryCurrencyFromText(job.description);
  if (detected && detected !== (job.salary_currency ?? null)) {
    return detected;
  }

  return job.salary_currency;
}

const ZONE_BAND_RE =
  /Zone\s+[A-Z]+:\s*((?:CA\$|C\$|US\$|\$|£|€)?[\d,]+(?:\.\d{2})?)\s*[–\-—]\s*((?:CA\$|C\$|US\$|\$|£|€)?[\d,]+(?:\.\d{2})?)(?:\s*(CAD|USD|GBP|EUR))?\s*(?:gross)?/gi;

const ANNUAL_ZONE_MIN = 20_000;
const ANNUAL_ZONE_MAX = 750_000;

type ParsedZoneBand = { min: number; max: number; currency: "CAD" | "USD" | "GBP" | "EUR" | null };

function parseDollarAmount(raw: string): number | null {
  const m = raw.match(/([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Currency from zone-band text; bare `$` alone does not count. */
function currencyFromZoneSegment(segment: string): "CAD" | "USD" | "GBP" | "EUR" | null {
  if (/(?:^|[^\w])CA\$|(?:^|[^\w])C\$(?=\d)|(?:^|[^\w])CAD(?:$|[^\w])/i.test(segment)) {
    return "CAD";
  }
  if (/(?:^|[^\w])US\$|(?:^|[^\w])USD(?:$|[^\w])/i.test(segment)) return "USD";
  if (/£|(?:^|[^\w])GBP(?:$|[^\w])/i.test(segment)) return "GBP";
  if (/€|(?:^|[^\w])EUR(?:$|[^\w])/i.test(segment)) return "EUR";
  return null;
}

function parseZoneSalaryBands(
  description: string | null | undefined,
): { bands: ParsedZoneBand[]; envelopeMin: number; envelopeMax: number; currency: "CAD" | "USD" | "GBP" | "EUR" | null } | null {
  const text = description?.trim();
  if (!text) return null;

  const bands: ParsedZoneBand[] = [];
  ZONE_BAND_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ZONE_BAND_RE.exec(text)) !== null) {
    const low = parseDollarAmount(match[1]);
    const high = parseDollarAmount(match[2]);
    if (low == null || high == null) continue;
    if (low < ANNUAL_ZONE_MIN || high < ANNUAL_ZONE_MIN) continue;
    if (low > ANNUAL_ZONE_MAX || high > ANNUAL_ZONE_MAX) continue;
    if (low > high) continue;

    const segment = match[0];
    const suffixCode = match[3]?.toUpperCase() as ParsedZoneBand["currency"] | undefined;
    const markerCurrency = currencyFromZoneSegment(segment);
    const currency = suffixCode ?? markerCurrency;
    bands.push({ min: low, max: high, currency });
  }

  if (bands.length < 2) return null;

  const nonNullCurrencies = bands.map((b) => b.currency).filter((c): c is NonNullable<typeof c> => c != null);
  const uniqueCurrencies = new Set(nonNullCurrencies);
  if (uniqueCurrencies.size > 1) return null;

  const currency = nonNullCurrencies[0] ?? null;
  const envelopeMin = Math.min(...bands.map((b) => b.min));
  const envelopeMax = Math.max(...bands.map((b) => b.max));

  return { bands, envelopeMin, envelopeMax, currency };
}

const NON_ANNUAL_SALARY_PERIODS = new Set([
  "hour",
  "hourly",
  "week",
  "weekly",
  "month",
  "monthly",
  "day",
  "daily",
]);

/**
 * When a posting lists multi-zone annual salary bands and stored min/max are
 * implausible (Unity Montreal SWE), replace with the envelope. Leave stored
 * amounts alone when they already match one posted band exactly.
 */
export function correctSalaryFromZoneTable(
  job: Pick<
    PublicJob,
    "salary_min" | "salary_max" | "salary_currency" | "salary_period" | "description"
  >,
): Pick<PublicJob, "salary_min" | "salary_max" | "salary_currency" | "salary_period"> {
  const parsed = parseZoneSalaryBands(job.description);
  if (!parsed) {
    return {
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      salary_period: job.salary_period,
    };
  }

  const { bands, envelopeMin, envelopeMax, currency } = parsed;
  const storedMin = job.salary_min;
  const storedMax = job.salary_max;

  const matchesExactBand = bands.some((b) => storedMin === b.min && storedMax === b.max);
  const matchesEnvelope = storedMin === envelopeMin && storedMax === envelopeMax;

  const implausible =
    storedMin == null ||
    storedMax == null ||
    storedMin < envelopeMin * 0.5 ||
    storedMin > envelopeMax ||
    storedMax > envelopeMax * 1.15;

  if (matchesExactBand || matchesEnvelope || !implausible) {
    return {
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      salary_currency: job.salary_currency,
      salary_period: job.salary_period,
    };
  }

  let salary_period = job.salary_period;
  const periodKey = salary_period?.toLowerCase() ?? "";
  if (!periodKey || NON_ANNUAL_SALARY_PERIODS.has(periodKey)) {
    salary_period = "year";
  }

  return {
    salary_min: envelopeMin,
    salary_max: envelopeMax,
    salary_currency: currency ?? job.salary_currency,
    salary_period,
  };
}

/** True when read-path corrections would change any trusted field. */
export function jobNeedsTrustCorrection(job: PublicJob): boolean {
  const corrected = applyTrustCorrections(job);
  return (
    corrected.company_domain !== job.company_domain ||
    corrected.salary_currency !== job.salary_currency ||
    corrected.salary_min !== job.salary_min ||
    corrected.salary_max !== job.salary_max ||
    corrected.salary_period !== job.salary_period
  );
}

/** Shallow copy with corrected domain / salary fields when rules fire. */
export function applyTrustCorrections(job: PublicJob): PublicJob {
  const company_domain = correctCompanyDomain(job);
  const zoneSalary = correctSalaryFromZoneTable(job);
  const salary_currency = correctSalaryCurrency({
    ...job,
    salary_currency: zoneSalary.salary_currency,
  });

  const unchanged =
    company_domain === job.company_domain &&
    zoneSalary.salary_min === job.salary_min &&
    zoneSalary.salary_max === job.salary_max &&
    zoneSalary.salary_period === job.salary_period &&
    salary_currency === job.salary_currency;

  if (unchanged) return job;

  return {
    ...job,
    company_domain,
    salary_min: zoneSalary.salary_min,
    salary_max: zoneSalary.salary_max,
    salary_period: zoneSalary.salary_period,
    salary_currency,
  };
}
