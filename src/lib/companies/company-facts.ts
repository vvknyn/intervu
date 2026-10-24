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
import type { TrackRecord } from "@/lib/companies/aggregates";
import type { CompanyExhaust, WeeklyCadence } from "@/lib/companies/exhaust";
import type { OpenCount } from "@/lib/companies/open-count";
import { typicalPayText } from "@/lib/companies/presentation";
import { evidencedSkills } from "@/lib/jobs/presentation";
import { classifyCountryValue, rollupCountryDistribution, UNCLASSIFIED_LABEL } from "@/lib/jobs/country-classification";
import { toValueArray, type FacetDistribution, type PublicJob } from "@/lib/jobs/types";

export interface Distribution {
  /** Highest count first; 'unknown'/blank values are never a bucket. */
  buckets: { value: string; count: number }[];
  /** Roles that state the attribute (copy says "of N roles that state a work
   *  mode"). Null for multi-valued facets, where bucket counts overlap and a
   *  per-role count cannot be recovered from a facet. */
  stated: number | null;
  /** Every role the counts were taken over (all live roles for a facet; the
   *  fetched window for skills). */
  total: number;
}

export interface CompanyFacts {
  identity: {
    name: string;
    domain: string;
    sector: string | null;
    /** The ATS hiring.cafe names for the employer; null when it names none. */
    atsProvider: string | null;
    profile: {
      tagline: string | null;
      yearFounded: number | null;
      employees: string | null;
      hqCountry: string | null;
      industries: string[];
    } | null;
    /** Present exactly when `profile` is; rendered as "Source: hiring.cafe". */
    profileSource: { domain: "hiring.cafe"; fetchedAt: string } | null;
  };
  hiring: {
    openCount: number;
    openCountIsLowerBound: boolean;
    opened90d: number | null;
    closed90d: number | null;
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
}

export interface CompanyFactsInput {
  name: string;
  domain: string;
  jobs: readonly PublicJob[];
  openCount: OpenCount;
  trackRecord?: TrackRecord | null;
  ghostFlaggedPct?: number | null;
  facetDistribution?: FacetDistribution;
  exhaust?: CompanyExhaust | null;
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
  const all = Object.entries(raw ?? {})
    .filter(([value, count]) => isStated(value) && count > 0)
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

function buildProfile(exhaust: CompanyExhaust | null | undefined) {
  const section = exhaust?.profile;
  if (!section) return { profile: null, profileSource: null };
  const p = section.data;
  const profile = {
    tagline: p.tagline,
    yearFounded: p.yearFounded,
    employees: p.nbEmployees,
    hqCountry: p.hqCountry,
    industries: p.industries,
  };
  const present = profile.tagline || profile.yearFounded != null || profile.employees || profile.hqCountry || profile.industries.length > 0;
  return present
    ? { profile, profileSource: { domain: "hiring.cafe" as const, fetchedAt: section.asOf } }
    : { profile: null, profileSource: null };
}

export function buildCompanyFacts(input: CompanyFactsInput): CompanyFacts {
  const { jobs, openCount, exhaust, facetDistribution: facets } = input;
  const total = openCount.value;
  const { profile, profileSource } = buildProfile(exhaust);
  const visa = facets?.visa_sponsorship;
  const sponsors = visa?.true ?? 0;
  const stated = sponsors + (visa?.false ?? 0);
  return {
    identity: {
      name: input.name,
      domain: input.domain,
      sector: exhaust?.sector ?? null,
      atsProvider: exhaust?.profile?.data.atsHint ?? null,
      profile,
      profileSource,
    },
    hiring: {
      openCount: total,
      openCountIsLowerBound: openCount.isLowerBound,
      opened90d: input.trackRecord?.opened90d ?? null,
      closed90d: input.trackRecord?.closed90d ?? null,
      monitoredSince: exhaust?.cadence?.data.trackedSinceIso ?? null,
      lastPostedAt: latestIso(jobs, (j) => j.posted_at),
      lastSeenAliveAt: latestIso(jobs, (j) => j.last_observed_alive_at),
      cadence: exhaust?.cadence?.data.weeks ?? null,
    },
    mix: {
      countries: buildDistribution(countryCounts(facets?.location_country), total, { multiValued: true, limit: COUNTRY_LIMIT }),
      workType: buildDistribution(facets?.work_type, total),
      employmentType: buildDistribution(facets?.employment_type, total),
      experienceLevel: buildDistribution(facets?.experience_level, total),
      visaSponsorship: stated > 0 ? { sponsors, stated, total } : null,
      skills: buildDistribution(skillCounts(jobs), jobs.length, { multiValued: true }),
      tech: buildDistribution(facets?.tech_stack, total, { multiValued: true }),
    },
    pay: buildPay(jobs),
    health: { ghostFlaggedPct: input.ghostFlaggedPct ?? null, verdict: exhaust?.health?.data.verdict ?? null },
  };
}
