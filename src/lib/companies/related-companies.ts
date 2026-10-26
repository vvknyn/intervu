import type { IndexableCompanyDomain, WikidataItem } from "./indexable";
import { resolveOpenCounts, type DirectoryCompany } from "./directory-model";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import type { OpenCount } from "./open-count";
import type { CompanyFacts } from "./company-facts";
import { searchJobs } from "@/lib/jobs/search";
import { categoryLabel } from "./machine-token";
import type { FacetKey, JobSearchParams, JobSearchResult } from "@/lib/jobs/types";

export const RELATED_LIMIT = 6;

/**
 * Companies that share the candidate pool, from the sitemap-indexable set only, never `self`.
 * Ranked by shared hits (how many of the facet search's hits are the company's, so a company whose
 * roles mostly carry the facet outranks a giant with one), then live roles (the directory's
 * `open_role_count`), then domain so ties are stable. The directory carries no skill or country
 * field, so sharing is decided by the caller's facet search, whose hit domains are `hitDomains`
 * (one entry per hit, repeats counted).
 */
export function buildRelatedCompanies<T extends IndexableCompanyDomain>(
  hitDomains: readonly string[],
  indexable: readonly T[],
  self: string,
  limit = RELATED_LIMIT,
): T[] {
  const hits = new Map<string, number>();
  for (const d of hitDomains) hits.set(d, (hits.get(d) ?? 0) + 1);
  return indexable
    .filter((c) => c.domain !== self && hits.has(c.domain))
    .sort((a, b) => hits.get(b.domain)! - hits.get(a.domain)! || b.openRoleCount - a.openRoleCount || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}

/** What related companies share: a Meili facet, or a Wikidata industry (decided from the directory alone, no search). */
export type RelatedFacet = { key: FacetKey | "industry"; value: string };

const industryKey = (label: string) => label.trim().toLowerCase();

/** The distinct Wikidata industry labels of a directory entry, keyed case-insensitively to the first spelling. */
function industriesOf(c: { wikidataIndustries?: readonly WikidataItem[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const label of c.wikidataIndustries?.flatMap((i) => i.industries) ?? []) if (industryKey(label)) out.set(industryKey(label), label);
  return out;
}

/** The rungs tried in order; the first with a value is the fact related companies share. `industries` are this company's own directory labels. */
const FACET_LADDER: readonly { key: RelatedFacet["key"]; top: (facts: CompanyFacts, industries: ReadonlyMap<string, string>) => string | undefined }[] = [
  { key: "must_have_skills", top: (f) => f.mix.skills?.buckets[0]?.value },
  { key: "tech_stack", top: (f) => f.mix.tech?.buckets[0]?.value },
  { key: "industry", top: (_, i) => [...i.values()][0] && categoryLabel([...i.values()][0]!) },
  { key: "location_country", top: (f) => f.mix.countries?.buckets[0]?.value },
];

/** The fact related companies share: the top stamped skill, else the top tech, else the company's first Wikidata industry, else the top country. */
export function relatedFacet(facts: CompanyFacts, industries: ReadonlyMap<string, string> = new Map()): RelatedFacet | null {
  for (const { key, top } of FACET_LADDER) {
    const value = top(facts, industries);
    if (value) return { key, value };
  }
  return null;
}

/** One entry per industry label `self` shares with each other company, so `buildRelatedCompanies` ranks by shared industries. */
export function industryHitDomains(self: ReadonlyMap<string, string>, indexable: readonly (IndexableCompanyDomain)[]): string[] {
  return indexable.flatMap((c) => [...industriesOf(c).keys()].filter((k) => self.has(k)).map(() => c.domain));
}

/** The heading states the fact the list is built on, never a relationship the data does not establish. */
export function relatedHeading(facet: RelatedFacet): string {
  if (facet.key === "location_country") return `Also hiring in ${facet.value}`;
  if (facet.key === "industry") return `Other ${facet.value} companies hiring`;
  return `Also hiring for ${facet.value}`;
}

/** The related companies with the facet they share. */
export interface RelatedCompanies {
  facet: RelatedFacet;
  companies: RelatedCompany[];
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

/** Thin I/O: one facet search (none for an industry), tallied by company, intersected with the indexable set, then the fresh counts. Null (section omitted) when there is no facet, the read fails, or nothing matches. */
export async function fetchRelatedCompanies(
  facts: CompanyFacts,
  search: (p: JobSearchParams) => Promise<JobSearchResult> = searchJobs,
  indexable: () => Promise<DirectoryCompany[]> = resolveIndexableCompanies,
  readCounts: typeof resolveOpenCounts = resolveOpenCounts,
): Promise<RelatedCompanies | null> {
  try {
    const set = await indexable();
    const own = industriesOf(set.find((c) => c.domain === facts.identity.domain) ?? {});
    const facet = relatedFacet(facts, own);
    if (!facet) return null;
    const hitDomains = facet.key === "industry"
      ? industryHitDomains(own, set)
      : (await search({ facets: { [facet.key]: [facet.value] }, limit: 200, hideGhosts: false })).hits.map((j) => j.company_domain ?? "");
    const selected = buildRelatedCompanies(hitDomains, set, facts.identity.domain);
    const companies = withFreshCounts(selected, await readCounts(selected.map((c) => c.domain)));
    return companies.length ? { facet, companies } : null;
  } catch (error) {
    console.error(`related companies: read failed, section omitted: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
