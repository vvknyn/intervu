import type { MetadataRoute } from "next";
import { fetchIndexableCompanyDomains, type IndexableCompanyDomain } from "@/lib/companies/indexable";
import { companyBoardPath } from "@/lib/companies/paths";
import { BLOG_PATH, BLOG_POSTS, blogPostPath } from "@/lib/blog/posts";
import { CAREER_HUBS } from "./career-hubs";
import { getSiteUrl } from "./constants";
import { SITEMAP_PAGES } from "./indexability";

/**
 * When this server process started, which on this box is the deploy: the
 * pages have no per-page "last changed" signal, and a deploy is the only
 * moment their content changes. It does not advance between requests (an
 * ever-advancing lastmod reads as "changes on every crawl"). Also the floor
 * for a company whose directory doc carries no `computed_at`.
 */
const DEPLOYED_AT = new Date();

/**
 * The sitemap's entries. Every entry is a path the indexability policy lists
 * (`inSitemap`), is indexable and names itself as canonical (tests assert
 * this), and carries a lastmod.
 *
 * FAILURE POSTURE. The company section comes from Meilisearch. When that
 * fails, or answers with nothing, the last good set is served again (with one
 * error line giving its age): 3,000 URLs vanishing and reappearing reads worse
 * to a crawler than a slightly stale list. Only a process that has never had a
 * good answer serves the pages without /co/ entries, still never a 5xx.
 */
export interface CompanyCache {
  companies: IndexableCompanyDomain[];
  at: number;
}
const LAST_GOOD: { current: CompanyCache | null } = { current: null };

export async function buildSitemapEntries(
  fetchCompanies: () => Promise<IndexableCompanyDomain[]> = fetchIndexableCompanyDomains,
  lastGood: { current: CompanyCache | null } = LAST_GOOD,
): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const at = (path: string) => `${siteUrl}${path}`;

  let companies: IndexableCompanyDomain[] = [];
  let failure: string | null = null;
  try {
    companies = await fetchCompanies();
    if (companies.length === 0) failure = "company fetch returned nothing";
  } catch (error) {
    failure = `company fetch failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!failure) {
    lastGood.current = { companies, at: Date.now() };
  } else if (lastGood.current) {
    const ageMin = Math.round((Date.now() - lastGood.current.at) / 60_000);
    console.error(`sitemap: ${failure}, serving the last good /co/ set (${ageMin} min old)`);
    companies = lastGood.current.companies;
  } else {
    console.error(`sitemap: ${failure}, no earlier set to serve, listing pages without /co/ entries`);
  }

  return [
    ...SITEMAP_PAGES.map(({ path, changeFrequency, priority }) => ({
      url: at(path),
      lastModified: DEPLOYED_AT,
      changeFrequency,
      priority,
    })),
    ...CAREER_HUBS.map((hub) => ({ url: at(hub.path), lastModified: DEPLOYED_AT, changeFrequency: "weekly" as const, priority: 0.65 })),
    { url: at(BLOG_PATH), lastModified: DEPLOYED_AT, changeFrequency: "weekly", priority: 0.5 },
    // One entry per blog post, dated by when it was published, with its
    // pictures so image search can find them.
    ...BLOG_POSTS.map((post) => ({
      url: at(blogPostPath(post.slug)),
      lastModified: new Date(`${post.datePublished}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.5,
      images: Object.keys(post.images).map((src) => at(src)),
    })),
    ...companies.map(({ domain, computedAt }) => ({
      url: at(companyBoardPath(domain)),
      lastModified: computedAt ? new Date(computedAt) : DEPLOYED_AT,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
