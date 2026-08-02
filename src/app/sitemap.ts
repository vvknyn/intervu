import type { MetadataRoute } from "next";

const SITE_URL = "https://intervu.cc";

/**
 * /sitemap.xml — the public, indexable entry points. Authed app surfaces
 * (resume builder, applications, settings) are intentionally omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
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
      // Public agent/MCP marketing page (Task 10).
      url: `${SITE_URL}/agents`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
