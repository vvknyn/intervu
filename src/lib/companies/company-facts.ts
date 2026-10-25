/**
 * `CompanyFacts` — every aggregate fact `/co/[slug]` can state about a company,
 * built once from what the loader already fetched. Facts are public; actions
 * stay gated (S2 ruling), so this is the one contract the page sections, the
 * FAQ and the indexability rule read instead of each re-deriving a number.
 *
 * Every field is null when the data does not hold it: a section renders only
 * when its field is non-null, and nothing here is a placeholder. Pure — the
 * loader does the I/O and passes the results in.
 */
import { pickWikidata, wikidataSectorPick, type CompanyExhaust, type WeeklyCadence } from "@/lib/companies/exhaust";
import type { WikidataItem } from "@/lib/companies/indexable";
import { formatCount } from "@/lib/format";
import type { OpenCount } from "@/lib/companies/open-count";
import { categoryLabel, machineTokenLabel } from "@/lib/companies/machine-token";
import { typicalPayText } from "@/lib/companies/presentation";
import { evidencedSkills } from "@/lib/jobs/presentation";
import { classifyCountryValue, rollupCountryDistribution, UNCLASSIFIED_LABEL } from "@/lib/jobs/country-classification";
import { toValueArray, type FacetDistribution, type PublicJob } from "@/lib/jobs/types";

export interface Distribution {
  /** Highest count first; 'unknown'/blank values are never a bucket. */
  buckets: { value: string; count: number }[];
  /** Postings that state the attribute — a facet count, not a role count (copy says "of N listings that state a work
   *  mode"). Null for multi-valued facets, where bucket counts overlap and a
   *  per-role count cannot be recovered from a facet. */
  stated: number | null;
  /** The population the counts are shares of: for a facet, every matching posting the facet counted (see `postingTotal`). */
  total: number;
}

/** A public-record count and the date of its newest entry (null when the source carries no date). */
export interface FilingFact {
  count: number;
  latestAt: string | null;
}

export interface ProfileSource {
  name: "hiring.cafe" | "Wikidata" | "company website";
  url: string | null;
  fetchedAt: string | null;
}

export interface CompanyFacts {
  identity: {
    name: string;
    domain: string;
    sector: string | null;
    /** The ATS hiring.cafe names for the employer; null when it names none. */
    atsProvider: string | null;
    /** The careers page `company_boards` holds, http(s) only. */
    careersUrl: string | null;
    profile: {
      tagline: string | null;
      yearFounded: number | null;
      employees: string | null;
      /** Year of a Wikidata employee count; null for hiring.cafe's range and when Wikidata gives none. */
      employeesAsOf: number | null;
      hqCountry: string | null;
      industries: string[];
    } | null;
    /** Every source that contributed a shown identity fact (sector included); `url` only when it points at that record. */
    profileSources: ProfileSource[];
  };
  hiring: {
    openCount: number;
    openCountIsLowerBound: boolean;
    monitoredSince: string | null;
    lastPostedAt: string | null;
    lastSeenAliveAt: string | null;
    cadence: WeeklyCadence[] | null;
  };
  mix: {
    countries: Distribution | null;
    workType: Distribution | null;
    employmentType: Distribution | null;
    experienceLevel: Distribution | null;
    visaSponsorship: { sponsors: number; stated: number; total: number } | null;
    skills: Distribution | null;
    tech: Distribution | null;
  };
  /** `salary_currency` is default-filled USD upstream (carries no evidence of
   *  the currency), so pay counts only US-located roles. */
  pay: { typical: string | null; roles: number; scope: typeof PAY_SCOPE } | null;
  health: { ghostFlaggedPct: number | null; verdict: string | null };
  /** Public-record filings; each null when the record holds none. H-1B is the
   *  latest fiscal year's approvals, which carries a year, not a date. */
  filings: { sec: FilingFact | null; h1b: (FilingFact & { fiscalYear: number }) | null; warn: FilingFact | null };
}

export interface CompanyFactsInput {
  name: string;
  domain: string;
  jobs: readonly PublicJob[];
  openCount: OpenCount;
  /** Every posting the facet counts were taken over (duplicates and internal ones included): the
   *  denominator of every facet share, as opposed to the deduped `openCount`. */
  postingTotal: number;
  ghostFlaggedPct?: number | null;
  facetDistribution?: FacetDistribution;
  exhaust?: CompanyExhaust | null;
  /** The directory's Wikidata items for this domain: fills identity facts hiring.cafe lacks, with or without `exhaust`. */
  wikidata?: readonly WikidataItem[];
  /** The company's own homepage description: the tagline of last resort, after hiring.cafe and Wikidata. */
  siteDescription?: string | null;
}

export const PAY_SCOPE = "US roles listing pay";
const COUNTRY_LIMIT = 8;
const SKILL_LIMIT = 10;

const isStated = (value: string) => value.trim() !== "" && value.trim().toLowerCase() !== "unknown";

/** A facet's value->count as a {@link Distribution}, or null when no role
 *  states the attribute. */
export function buildDistribution(
  raw: Record<string, number> | undefined,
  total: number,
  { multiValued = false, limit = SKILL_LIMIT }: { multiValued?: boolean; limit?: number } = {},
): Distribution | null {
  // THE label chokepoint for every mix: raw facet tokens never reach a page. Multi-valued mixes (countries,
  // skills, tech) are proper names, so only underscore tokens are humanized; categorical ones always go through `categoryLabel`.
  const label = multiValued ? (v: string) => (v.includes("_") ? machineTokenLabel(v) : v) : categoryLabel;
  const merged = new Map<string, number>();
  for (const [value, count] of Object.entries(raw ?? {})) {
    if (isStated(value) && count > 0) merged.set(label(value), (merged.get(label(value)) ?? 0) + count);
  }
  const all = [...merged]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  if (all.length === 0) return null;
  return {
    buckets: all.slice(0, limit),
    stated: multiValued ? null : all.reduce((sum, b) => sum + b.count, 0),
    total,
  };
}

/** The raw `location_country` facet folded to real countries ("USA" and
 *  "United States" are one bucket); city/region/remote junk is dropped. */
function countryCounts(raw: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    rollupCountryDistribution(raw)
      .filter((row) => row.country !== UNCLASSIFIED_LABEL)
      .map((row) => [row.country, row.count]),
  );
}

/**
 * Skills named by the fetched roles, counted once per role. Not the
 * `must_have_skills` facet: it counts the unstamped rows whose skill lists the
 * evidence gate (`evidencedSkills`) hides as unverified. So this covers the
 * fetched window only, and `total` says so (`jobs.length`, not the open count).
 */
function skillCounts(jobs: readonly PublicJob[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    for (const skill of new Set(evidencedSkills(job, "must_have_skills"))) counts[skill] = (counts[skill] ?? 0) + 1;
  }
  return counts;
}

const isUsLocated = (job: PublicJob) =>
  toValueArray(job.location_country).some((v) => {
    const c = classifyCountryValue(v);
    return c.kind === "country" && c.canonical === "United States";
  });

/** The latest of a timestamp field across `jobs`, as the original string. */
function latestIso(jobs: readonly PublicJob[], read: (job: PublicJob) => string | null | undefined): string | null {
  let best: { ms: number; iso: string } | null = null;
  for (const job of jobs) {
    const iso = read(job);
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(ms) && (!best || ms > best.ms)) best = { ms, iso: iso as string };
  }
  return best?.iso ?? null;
}

function buildPay(jobs: readonly PublicJob[]): CompanyFacts["pay"] {
  const us = jobs.filter(isUsLocated);
  const roles = us.filter((j) => j.salary_min != null || j.salary_max != null).length;
  return roles === 0 ? null : { typical: typicalPayText(us), roles, scope: PAY_SCOPE };
}

/** THE HQ formatter, whatever the source: an ISO 3166 alpha-2 code becomes its English country name (kept as is when Intl does not know it); any other string passes through. */
function countryName(value: string): string {
  if (!/^[A-Z]{2}$/.test(value)) return value;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value;
  } catch {
    return value;
  }
}

/** A Wikidata description of more than one word: a single word adds nothing. */
const describes = (item: WikidataItem) => (item.description && item.description.trim().split(/\s+/).length > 1 ? item.description : null);

/** Identity facts per field: hiring.cafe's value first, else the one Wikidata value (see `pickWikidata`); the sector is `exhaust.sector`, else Wikidata's. Every source of a shown fact is named. */
function buildIdentityFacts(exhaust: CompanyExhaust | null | undefined, wikidata: readonly WikidataItem[], name: string, domain: string, siteDescription: string | null | undefined) {
  const section = exhaust?.profile;
  const p = section?.data;
  const wd = <T>(read: (item: WikidataItem) => T | null) => pickWikidata(wikidata, name, read);
  const wdTagline = wd(describes);
  // Homepage meta text is free-form: values under 5 words are page labels, not descriptions.
  const siteTagline = !p?.tagline && !wdTagline && siteDescription && siteDescription.trim().split(/\s+/).length >= 5 ? siteDescription.trim() : null;
  const wdFounded = wd((i) => i.founded ?? null);
  const wdHq = wd((i) => (i.hqCountry ? countryName(i.hqCountry) : null));
  const wdEmployees = wd((i) => i.employees ?? null);
  const wdSector = exhaust?.sector ? null : wikidataSectorPick(wikidata, name);
  const profile = {
    tagline: p?.tagline || wdTagline?.value || siteTagline,
    yearFounded: p?.yearFounded ?? wdFounded?.value ?? null,
    employees: p?.nbEmployees || (wdEmployees ? formatCount(wdEmployees.value) : null),
    employeesAsOf: p?.nbEmployees ? null : (wdEmployees?.item.employeesAsOf ?? null),
    hqCountry: countryName(p?.hqCountry || wdHq?.value || "") || null,
    industries: p?.industries ?? [],
  };
  const fromHiringCafe = !!p && !!(p.tagline || p.yearFounded != null || p.nbEmployees || p.hqCountry || p.industries.length > 0);
  const wikiPicks = [
    p?.tagline ? null : wdTagline,
    p?.yearFounded != null ? null : wdFounded,
    p?.nbEmployees ? null : wdEmployees,
    p?.hqCountry ? null : wdHq,
    wdSector,
  ].filter((x) => x !== null);
  const ids = new Set(wikiPicks.map((x) => x.item.id));
  const wikidataId = ids.size === 1 && wikiPicks.every((x) => x.item.id) ? [...ids][0] : null;
  const profileSources: ProfileSource[] = [
    ...(fromHiringCafe && section ? [{ name: "hiring.cafe" as const, url: null, fetchedAt: section.asOf }] : []),
    ...(wikiPicks.length > 0 ? [{ name: "Wikidata" as const, url: wikidataId ? `https://www.wikidata.org/wiki/${wikidataId}` : null, fetchedAt: null }] : []),
    ...(siteTagline ? [{ name: "company website" as const, url: `https://${domain}`, fetchedAt: null }] : []),
  ];
  const present = profile.tagline || profile.yearFounded != null || profile.employees || profile.hqCountry || profile.industries.length > 0;
  return { profile: present ? profile : null, profileSources, sector: exhaust?.sector ?? wdSector?.value ?? null };
}

const newestIso = (dates: readonly (string | null | undefined)[]): string | null =>
  dates.reduce<string | null>((best, d) => (d && !Number.isNaN(Date.parse(d)) && (!best || Date.parse(d) > Date.parse(best)) ? d : best), null);

function buildFilings(exhaust: CompanyExhaust | null | undefined): CompanyFacts["filings"] {
  const sec = exhaust?.secListing?.data;
  const h1b = exhaust?.h1bLca?.data;
  const warn = exhaust?.warnNotices?.data;
  const secCount = sec?.totalFilings2y ?? 0;
  const h1bCount = h1b ? h1b.initialApprovals + h1b.continuingApprovals : 0;
  return {
    sec: sec && secCount > 0 ? { count: secCount, latestAt: newestIso([sec.latest10kDate, sec.latest10qDate, sec.latest8kDate, sec.latestS1Date]) } : null,
    h1b: h1b && h1bCount > 0 ? { count: h1bCount, latestAt: null, fiscalYear: h1b.fiscalYear } : null,
    warn: warn && warn.noticeCount > 0 ? { count: warn.noticeCount, latestAt: newestIso(warn.recent.map((n) => n.noticeDate)) } : null,
  };
}

export function buildCompanyFacts(input: CompanyFactsInput): CompanyFacts {
  const { jobs, openCount, exhaust, facetDistribution: facets } = input;
  const total = openCount.value;
  const postings = input.postingTotal;
  const { profile, profileSources, sector } = buildIdentityFacts(exhaust, input.wikidata ?? [], input.name, input.domain, input.siteDescription);
  const visa = facets?.visa_sponsorship;
  const sponsors = visa?.true ?? 0;
  const stated = sponsors + (visa?.false ?? 0);
  return {
    identity: {
      name: input.name,
      domain: input.domain,
      sector,
      atsProvider: exhaust?.profile?.data.atsHint ?? null,
      careersUrl: exhaust?.careersUrl ?? null,
      profile,
      profileSources,
    },
    hiring: {
      openCount: total,
      openCountIsLowerBound: openCount.isLowerBound,
      monitoredSince: exhaust?.integrity?.data.trackedSinceIso ?? null,
      lastPostedAt: latestIso(jobs, (j) => j.posted_at),
      lastSeenAliveAt: latestIso(jobs, (j) => j.last_observed_alive_at),
      cadence: exhaust?.cadence?.data.weeks ?? null,
    },
    mix: {
      countries: buildDistribution(countryCounts(facets?.location_country), postings, { multiValued: true, limit: COUNTRY_LIMIT }),
      workType: buildDistribution(facets?.work_type, postings),
      employmentType: buildDistribution(facets?.employment_type, postings),
      experienceLevel: buildDistribution(facets?.experience_level, postings),
      visaSponsorship: stated > 0 ? { sponsors, stated, total: postings } : null,
      skills: buildDistribution(skillCounts(jobs), jobs.length, { multiValued: true }),
      tech: buildDistribution(facets?.tech_stack, postings, { multiValued: true }),
    },
    pay: buildPay(jobs),
    health: { ghostFlaggedPct: input.ghostFlaggedPct ?? null, verdict: exhaust?.health?.data.verdict ?? null },
    filings: buildFilings(exhaust),
  };
}
