import type { MetadataRoute } from "next";

const SITE_URL = "https://intervu.cc";

/**
 * /robots.txt — allow crawling of public pages, keep authed/admin/API surfaces
 * out of the index. Server actions and Firebase data are behind auth regardless;
 * these disallows just keep them out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/settings", "/account", "/reset-password", "/oauth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
