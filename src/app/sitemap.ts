import type { MetadataRoute } from "next";
import { getBoardDomains } from "@/lib/boards/allowlists";
import { domainToSlug } from "@/lib/boards/slug";
import { getSiteUrl } from "@/lib/seo/constants";

/**
 * /sitemap.xml — the public, indexable entry points. Authed app surfaces
 * (resume builder, applications, settings) are intentionally omitted, as is
 * `/login` (a sign-in form, not a content page — indexing it just spends
 * crawl budget on a page with nothing for a search result to rank on).
 * `/yours` is public (#153) but an empty shell for a crawler with no
 * session, so it's left out too; `/connect` stays in since it's a real
 * product page regardless of auth state.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  // `/co/[slug]` company pages — one entry per tracked elite-board domain.
  // Derived from the same allowlist + slug encoding every other `/co/[slug]`
  // caller uses (get-company.ts, hot-list.ts, jobCompanyHref) rather than a
  // hand-maintained company list, so it grows/shrinks with the tracked file.
  const companyEntries: MetadataRoute.Sitemap = getBoardDomains("elite").map((domain) => ({
    url: `${siteUrl}/co/${domainToSlug(domain)}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [
    {
      // Jobs search — the front door; `/` 307s here since Phase 1b.
      url: `${siteUrl}/jobs`,
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/trends`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // MCP pairing / waitlist — pre-launch beta, publicly linkable. Also
      // the canonical human landing spot for the agent/MCP surface (Task 10
      // page consolidation): `/agents` now permanently redirects here rather
      // than carrying its own sitemap entry, so a redirecting URL never
      // competes with its own target for crawl budget.
      url: `${siteUrl}/connect`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/research/ghost-jobs`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/contact`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${siteUrl}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...companyEntries,
  ];
}
