import type { MetadataRoute } from "next";
import { getBoardDomains } from "@/lib/boards/allowlists";
import { domainToSlug } from "@/lib/boards/slug";
import { SITE_URL } from "@/lib/seo/constants";

/**
 * /sitemap.xml — the public, indexable entry points. Authed app surfaces
 * (resume builder, applications, settings) are intentionally omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // `/co/[slug]` company pages — one entry per tracked elite-board domain.
  // Derived from the same allowlist + slug encoding every other `/co/[slug]`
  // caller uses (get-company.ts, hot-list.ts, jobCompanyHref) rather than a
  // hand-maintained company list, so it grows/shrinks with the tracked file.
  const companyEntries: MetadataRoute.Sitemap = getBoardDomains("elite").map((domain) => ({
    url: `${SITE_URL}/co/${domainToSlug(domain)}`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [
    {
      // Jobs search — the root route since the jobs-first flip (PR 1).
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      // Interview prep — moved off root, still public (PR 1).
      url: `${SITE_URL}/prep`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/trends`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      // MCP pairing / waitlist — pre-launch beta, publicly linkable.
      url: `${SITE_URL}/connect`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/research/ghost-jobs`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/contact`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...companyEntries,
  ];
}
