import type { MetadataRoute } from "next";
import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";

/**
 * /sitemap.xml — the public, indexable entry points, built from the
 * indexability policy (lib/seo/indexability.ts) in lib/seo/sitemap-entries.ts,
 * which also states the failure posture. Authed app surfaces, `/login` and
 * `/yours` are not in the policy's sitemap set, so they never appear.
 *
 * `/co/` entries are the `company_directory` domains with at least
 * MIN_SITEMAP_ROLES live roles (top SITEMAP_COMPANY_CAP): see
 * `fetchIndexableCompanyDomains`. `force-dynamic` keeps the route out of
 * `next build`, so a Meilisearch error can never fail a build; its fetch
 * carries its own `revalidate`, so requests share one round trip per window.
 */
export const dynamic = "force-dynamic";

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries();
}
