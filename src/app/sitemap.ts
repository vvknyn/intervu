import type { MetadataRoute } from "next";

const SITE_URL = "https://intervu.cc";

/**
 * /sitemap.xml — the public, indexable entry points. Authed app surfaces
 * (dashboard, resume builder, applications, settings) are intentionally omitted.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/jobs`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
