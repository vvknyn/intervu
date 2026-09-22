import type { PublicJob } from "./types";
import { toValueArray } from "./types";

/**
 * Read-path trust corrections for Meili documents — domain affiliation and
 * salary currency inferred from posting text. Applied at the Meili→wire
 * boundary (`normalizePublicJob`). Upstream jobs-sync may still write bad
 * values; the Contabo repair script backfills live Meili docs.
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
  regions: Partial<Record<"CA", string>>;
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
    regions: { CA: "td.com" },
  },
];

const CANADA_COMPANY_SUFFIX = /\((?:canada|canadian)\)/i;

const SALARY_CONTEXT =
  /\b(salary|compensation|pay(?:\s+range)?|wage|remuneration|package|earning|income|annual(?:ly)?|hourly|base\s+pay|total\s+compensation)\b/gi;

const SALARY_AMOUNT =
  /\$[\d,]+(?:\.\d{2})?(?:\s*[–\-—]\s*\$[\d,]+(?:\.\d{2})?|\s*(?:to|-)\s*\$[\d,]+(?:\.\d{2})?)?/g;

type CurrencyMarker = { code: "CAD" | "USD" | "GBP" | "EUR"; pattern: RegExp };

const CURRENCY_MARKERS: CurrencyMarker[] = [
  { code: "CAD", pattern: /\bCAD\b|\bCA\$|\bC\$(?=\d)|\bCanadian dollars?\b/gi },
  { code: "USD", pattern: /\bUSD\b|\bUS\$/gi },
  { code: "GBP", pattern: /\bGBP\b|£|\bpounds?(?:\s+sterling)?\b/gi },
  { code: "EUR", pattern: /\bEUR\b|€|\beuros?\b/gi },
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

/** Job is Canada-scoped when the company name or location_country says so. */
export function isCanadaJobContext(
  job: Pick<PublicJob, "company" | "location_country">,
): boolean {
  const company = job.company?.trim() ?? "";
  if (CANADA_COMPANY_SUFFIX.test(company)) return true;
  return isCanadaLocationCountry(job.location_country);
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

  if (!isCanadaJobContext(job)) return original ?? null;

  const affiliation = findBrandAffiliation(job.company);
  if (!affiliation?.regions.CA) return original ?? null;

  const canonical = affiliation.regions.CA;
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
    marker.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = marker.pattern.exec(text)) !== null) {
      const index = m.index;
      let distance = contextPositions.length === 0 ? Infinity : Infinity;
      for (const pos of contextPositions) {
        distance = Math.min(distance, Math.abs(index - pos));
      }
      hits.push({ code: marker.code, distance, index });
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
 * When salary figures exist and posting text names a currency different from
 * stored `salary_currency`, return the text-derived code. Never invents from
 * location.
 */
export function correctSalaryCurrency(
  job: Pick<PublicJob, "salary_min" | "salary_max" | "salary_currency" | "description">,
): string | null {
  if (job.salary_min == null && job.salary_max == null) {
    return job.salary_currency;
  }

  const detected = detectSalaryCurrencyFromText(job.description);
  if (detected && detected !== (job.salary_currency ?? null)) {
    return detected;
  }

  return job.salary_currency;
}

/** True when read-path corrections would change domain or salary currency. */
export function jobNeedsTrustCorrection(job: PublicJob): boolean {
  const domain = correctCompanyDomain(job);
  const currency = correctSalaryCurrency(job);
  return domain !== job.company_domain || currency !== job.salary_currency;
}

/** Shallow copy with corrected `company_domain` / `salary_currency` when rules fire. */
export function applyTrustCorrections(job: PublicJob): PublicJob {
  const company_domain = correctCompanyDomain(job);
  const salary_currency = correctSalaryCurrency(job);

  if (company_domain === job.company_domain && salary_currency === job.salary_currency) {
    return job;
  }

  return {
    ...job,
    company_domain,
    salary_currency,
  };
}
