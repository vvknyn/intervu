import { fetchIndexableCompanyDomains, type IndexableCompanyDomain } from "./indexable";
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
export function buildRelatedCompanies(
  candidateDomains: Iterable<string>,
  indexable: readonly IndexableCompanyDomain[],
  self: string,
  limit = RELATED_LIMIT,
): IndexableCompanyDomain[] {
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

/** Thin I/O: one facet search, tallied by company, intersected with the indexable set. Fails soft to []. */
export async function fetchRelatedCompanies(
  facts: CompanyFacts,
  search: (p: JobSearchParams) => Promise<JobSearchResult> = searchJobs,
  indexable: () => Promise<IndexableCompanyDomain[]> = fetchIndexableCompanyDomains,
): Promise<IndexableCompanyDomain[]> {
  const facet = relatedFacet(facts);
  if (!facet) return [];
  try {
    const [result, set] = await Promise.all([
      search({ facets: { [facet.key]: [facet.value] }, limit: 200, hideGhosts: false }),
      indexable(),
    ]);
    return buildRelatedCompanies(result.hits.map((j) => j.company_domain ?? ""), set, facts.identity.domain);
  } catch (error) {
    console.error(`related companies: read failed, section omitted: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
