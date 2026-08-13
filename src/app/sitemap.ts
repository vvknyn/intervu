import type { MetadataRoute } from "next";
import { getBoardDomains } from "@/lib/boards/allowlists";
import { fetchLiveRoleCountsByDomain, hasIndexableCompanyContent } from "@/lib/companies/indexable";
import { companyBoardPath } from "@/lib/companies/paths";
import { getSiteUrl } from "@/lib/seo/constants";

/**
 * /sitemap.xml — the public, indexable entry points. Authed app surfaces
 * (resume builder, applications, settings) are intentionally omitted, as is
 * `/login` (a sign-in form, not a content page — indexing it just spends
 * crawl budget on a page with nothing for a search result to rank on).
 * `/yours` is public (#153) but an empty shell for a crawler with no
 * session, so it's left out too; `/connect` stays in since it's a real
 * product page regardless of auth state.
 *
 * FAILURE POSTURE (deliberate — read before "fixing" the throw below).
 * The `/co/` section is now measured, not asserted, so this route can fail
 * where it previously could not. The three candidate behaviours on a
 * Meilisearch outage are not equivalent:
 *
 *   - Emit the full allowlist anyway. This is the bug being removed: it
 *     re-asserts coverage for 166 pages that render nothing.
 *   - Emit 200 with the `/co/` section omitted. WORST option. A sitemap that
 *     successfully returns and no longer contains 442 URLs it contained an
 *     hour ago is a deliberate-looking mass removal — a transient index blip
 *     would be reported to Google as "we took those pages down."
 *   - Fail the request. A 5xx sitemap is the ONE outcome search engines
 *     already treat correctly: fetch failed, retry later, keep the last good
 *     copy. Nothing is dropped, nothing is claimed. Absence of a measurement
 *     stays distinct from a measurement of absence.
 *
 * So this throws, and `dynamic = "force-dynamic"` is what makes throwing
 * safe. It reconciles with the repo's standing "never fail the build on a
 * Meili error" posture (see `app/companies/[slug]/page.tsx`) more strongly
 * than the `isBuildPhase()` degradation those ISR pages use: this route is
 * never prerendered at all, so `next build` never touches Meilisearch for it
 * and cannot fail on it — the error surfaces at request time, as a 500, to a
 * crawler equipped to handle exactly that.
 *
 * Cost: `meiliMultiSearch` carries its own `next: { revalidate }`, and an
 * explicit fetch revalidate still populates Next's Data Cache under
 * `force-dynamic` (verified in next@16.3.0 `patch-fetch.js` — the
 * force-dynamic no-store coupling only applies when the fetch sets no cache
 * options of its own). Public requests to /sitemap.xml therefore share one
 * batched Meili round trip per revalidation window, not one per request.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  // `/co/[slug]` company pages. The allowlist decides which companies are
  // CANDIDATES (same source every other `/co/[slug]` caller uses —
  // get-company.ts, hot-list.ts, jobCompanyHref — so it tracks that file);
  // `hasIndexableCompanyContent` decides which of them have a page worth
  // submitting. Same predicate the page's own robots meta runs, so the
  // sitemap can never list a URL the page marks `noindex`.
  //
  // `hasTrackRecord` is deliberately not passed: an aggregation query cannot
  // observe it (the index carries no `company_*` fields), and this shape
  // takes an omitted value as "unobserved" rather than as a false claim. The
  // consequence is stated rather than hidden — the sitemap is a SUBSET of
  // what the page considers indexable, never a superset. Under-listing a
  // page that a crawler can still reach through `/jobs` is recoverable;
  // over-listing empty pages is the thing being fixed.
  const domains = getBoardDomains("elite");
  const liveRoleCounts = await fetchLiveRoleCountsByDomain(domains);
  const companyEntries: MetadataRoute.Sitemap = domains
    .filter((domain) =>
      hasIndexableCompanyContent({ openRoleCount: liveRoleCounts.get(domain.toLowerCase()) ?? 0 }),
    )
    .map((domain) => ({
      url: `${siteUrl}${companyBoardPath(domain)}`,
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
