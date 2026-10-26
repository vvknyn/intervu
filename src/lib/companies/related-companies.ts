import type { IndexableCompanyDomain, WikidataItem } from "./indexable";
import { resolveOpenCounts, type DirectoryCompany } from "./directory-model";
import { resolveIndexableCompanies } from "@/lib/seo/sitemap-entries";
import type { OpenCount } from "./open-count";
import type { CompanyFacts } from "./company-facts";
import { searchJobs } from "@/lib/jobs/search";
import { categoryLabel } from "./machine-token";
import { pickWikidata } from "./exhaust";
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

/** The industry related companies share, and one hit per industry label each peer shares with this company. */
export interface IndustryPeers { value: string; hitDomains: string[] }

/**
 * Pure: this company's industries are those of the Wikidata item the page itself uses (`pickWikidata`, as the sector does),
 * none when the items disagree. The named industry is the first of them that a peer also has; a peer qualifies only when
 * EVERY Wikidata item on its entry lists that label, so an ambiguous identity can never make the heading false.
 * Null when no label has a peer.
 */
export function industryPeers(
  items: readonly WikidataItem[],
  displayName: string,
  indexable: readonly IndexableCompanyDomain[],
  self: string,
): IndustryPeers | null {
  const own = pickWikidata(items, displayName, (i) => (i.industries.length ? i.industries : null))?.value ?? [];
  const ownKeys = new Set(own.map(industryKey));
  const sharedByAll = (c: IndexableCompanyDomain) => {
    const lists = (c.wikidataIndustries ?? []).map((i) => new Set(i.industries.map(industryKey)));
    return lists.length ? [...ownKeys].filter((k) => lists.every((l) => l.has(k))) : [];
  };
  const peers = indexable.filter((c) => c.domain !== self).map((c) => ({ domain: c.domain, shared: sharedByAll(c) }));
  for (const label of own) {
    const named = peers.filter((p) => p.shared.includes(industryKey(label)));
    if (named.length) return { value: categoryLabel(label), hitDomains: named.flatMap((p) => p.shared.map(() => p.domain)) };
  }
  return null;
}

/** The rungs tried in order; the first with a value is the fact related companies share. */
const FACET_LADDER: readonly { key: RelatedFacet["key"]; top: (facts: CompanyFacts, industry: string | undefined) => string | undefined }[] = [
  { key: "must_have_skills", top: (f) => f.mix.skills?.buckets[0]?.value },
  { key: "tech_stack", top: (f) => f.mix.tech?.buckets[0]?.value },
  { key: "industry", top: (_, industry) => industry },
  { key: "location_country", top: (f) => f.mix.countries?.buckets[0]?.value },
];

/** The fact related companies share: the top stamped skill, else the top tech, else the named Wikidata industry (see `industryPeers`), else the top country. */
export function relatedFacet(facts: CompanyFacts, industry?: string): RelatedFacet | null {
  for (const { key, top } of FACET_LADDER) {
    const value = top(facts, industry);
    if (value) return { key, value };
  }
  return null;
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
    const self = set.find((c) => c.domain === facts.identity.domain);
    const industry = industryPeers(self?.wikidataIndustries ?? [], facts.identity.name, set, facts.identity.domain);
    const facet = relatedFacet(facts, industry?.value);
    if (!facet) return null;
    const hitDomains = facet.key === "industry"
      ? industry!.hitDomains
      : (await search({ facets: { [facet.key]: [facet.value] }, limit: 200, hideGhosts: false })).hits.map((j) => j.company_domain ?? "");
    const selected = buildRelatedCompanies(hitDomains, set, facts.identity.domain);
    const companies = withFreshCounts(selected, await readCounts(selected.map((c) => c.domain)));
    return companies.length ? { facet, companies } : null;
  } catch (error) {
    console.error(`related companies: read failed, section omitted: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
