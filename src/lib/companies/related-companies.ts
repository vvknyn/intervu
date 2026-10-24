import type { IndexableCompanyDomain } from "./indexable";
import type { DirectoryCompany } from "./directory-model";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import { fetchOpenCounts } from "./listed-names";
import type { OpenCount } from "./open-count";
import type { CompanyFacts } from "./company-facts";
import { searchJobs } from "@/lib/jobs/search";
import type { FacetKey, JobSearchParams, JobSearchResult } from "@/lib/jobs/types";

export const RELATED_LIMIT = 6;

/**
 * Companies that share the candidate pool, from the sitemap-indexable set only,
 * never `self`, ranked by live roles (the directory's `open_role_count`) then
 * domain so ties are stable. The directory carries no skill or country field,
 * only domain / open_role_count / computed_at, so sharing is decided by the
 * caller's facet search, which supplies `candidateDomains`.
 */
export function buildRelatedCompanies<T extends IndexableCompanyDomain>(
  candidateDomains: Iterable<string>,
  indexable: readonly T[],
  self: string,
  limit = RELATED_LIMIT,
): T[] {
  const candidates = new Set(candidateDomains);
  return indexable
    .filter((c) => c.domain !== self && candidates.has(c.domain))
    .sort((a, b) => b.openRoleCount - a.openRoleCount || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}

/** The facet value related companies share: the top skill, else the top country. */
export function relatedFacet(facts: CompanyFacts): { key: FacetKey; value: string } | null {
  const skill = facts.mix.skills?.buckets[0];
  if (skill) return { key: "must_have_skills", value: skill.value };
  const country = facts.mix.countries?.buckets[0];
  return country ? { key: "location_country", value: country.value } : null;
}

/** A related company with its fresh open-roles count, or none when the count could not be read. */
export interface RelatedCompany {
  domain: string;
  name: string;
  openCount: OpenCount | null;
}

/**
 * Pure: the selected companies with their fresh counts, highest count first (a company with no count
 * after those with one), ties and unread rows keeping the selection's order. The memo number is never carried.
 */
export function withFreshCounts(selected: readonly DirectoryCompany[], counts: ReadonlyMap<string, OpenCount>): RelatedCompany[] {
  return selected
    .map(({ domain, name }) => ({ domain, name, openCount: counts.get(domain) ?? null }))
    .sort((a, b) => (b.openCount?.value ?? -1) - (a.openCount?.value ?? -1));
}

/** Thin I/O: one facet search, tallied by company, intersected with the indexable set, then the fresh counts. Fails soft to []. */
export async function fetchRelatedCompanies(
  facts: CompanyFacts,
  search: (p: JobSearchParams) => Promise<JobSearchResult> = searchJobs,
  indexable: () => Promise<DirectoryCompany[]> = resolveIndexableCompanies,
  readCounts: typeof fetchOpenCounts = fetchOpenCounts,
): Promise<RelatedCompany[]> {
  const facet = relatedFacet(facts);
  if (!facet) return [];
  try {
    const [result, set] = await Promise.all([
      search({ facets: { [facet.key]: [facet.value] }, limit: 200, hideGhosts: false }),
      indexable(),
    ]);
    const selected = buildRelatedCompanies(result.hits.map((j) => j.company_domain ?? ""), set, facts.identity.domain);
    return withFreshCounts(selected, await readCounts(selected.map((c) => c.domain)));
  } catch (error) {
    console.error(`related companies: read failed, section omitted: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
