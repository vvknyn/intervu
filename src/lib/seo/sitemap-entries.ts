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
 * FAILURE POSTURE. The company section comes from Meilisearch; when that
 * fails the sitemap is still served, with the static pages, hubs and blog
 * and one error line in the log, never a 5xx. A 500 sitemap is an outage on
 * a file Search Console watches daily, and the pages in it are unchanged by
 * the outage. The cost is that the `/co/` URLs are absent for that response;
 * a crawler keeps URLs it already knows, and the next fetch restores them.
 */
export async function buildSitemapEntries(
  fetchCompanies: () => Promise<IndexableCompanyDomain[]> = fetchIndexableCompanyDomains,
): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const at = (path: string) => `${siteUrl}${path}`;

  let companies: IndexableCompanyDomain[] = [];
  try {
    companies = await fetchCompanies();
  } catch (error) {
    console.error(`sitemap: company fetch failed, serving pages without /co/ entries: ${error instanceof Error ? error.message : String(error)}`);
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
