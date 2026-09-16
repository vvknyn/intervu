import type { MetadataRoute } from "next";
import { fetchIndexableCompanyDomains } from "@/lib/companies/indexable";
import { companyBoardPath } from "@/lib/companies/paths";
import { CAREER_HUBS } from "@/lib/seo/career-hubs";
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
 * Cost: `fetchIndexableCompanyDomains`'s own `company_directory` fetch
 * carries its own `next: { revalidate }`, and an explicit fetch revalidate
 * still populates Next's Data Cache under `force-dynamic` (verified in
 * next@16.3.0 `patch-fetch.js` — the force-dynamic no-store coupling only
 * applies when the fetch sets no cache options of its own). Public requests
 * to /sitemap.xml therefore share one Meili round trip per revalidation
 * window, not one per request.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const careerHubEntries: MetadataRoute.Sitemap = CAREER_HUBS.map((hub) => ({
    url: `${siteUrl}${hub.path}`,
    changeFrequency: "weekly",
    priority: 0.65,
  }));

  // `/co/[slug]` company pages. `fetchIndexableCompanyDomains` discovers the
  // CANDIDATES straight from the published `company_directory` index — every
  // domain with `open_role_count >= MIN_SITEMAP_ROLES`, capped — not the curated
  // "elite" board list, which `get-company.ts` never treated as a boundary
  // on which domains can render a page; see indexable.ts's 2026-08-13
  // docblock update. The threshold gate is applied server-side by that
  // function's own Meilisearch filter, so this route never reimplements it.
  //
  // `hasTrackRecord` is structurally unobservable here (the directory doc
  // carries a role count, not the page's `company_*` KPIs) and stays
  // omitted, which that gate reads as "unobserved" rather than a false
  // claim. The consequence is stated rather than hidden — the sitemap is a
  // SUBSET of what the page considers indexable, never a superset.
  // Under-listing a page that a crawler can still reach through `/jobs` is
  // recoverable; over-listing empty pages is the thing #171 fixed.
  const indexableDomains = await fetchIndexableCompanyDomains();
  const companyEntries: MetadataRoute.Sitemap = indexableDomains.map(({ domain, computedAt }) => ({
    url: `${siteUrl}${companyBoardPath(domain)}`,
    ...(computedAt ? { lastModified: new Date(computedAt) } : {}),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  // Static pages have no per-page "last changed" signal available to this
  // route, so `lastModified` is omitted rather than stamped with the request
  // time — a crawler reads an ever-advancing `lastModified` as "this page
  // changes every time we check," which is a worse signal than none.
  return [
    {
      // Jobs search — the front door; `/` 307s here since Phase 1b.
      url: `${siteUrl}/jobs`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/trends`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      // MCP pairing / waitlist — pre-launch beta, publicly linkable. Also
      // the canonical human landing spot for the agent/MCP surface (Task 10
      // page consolidation): `/agents` now permanently redirects here rather
      // than carrying its own sitemap entry, so a redirecting URL never
      // competes with its own target for crawl budget.
      url: `${siteUrl}/connect`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/research/ghost-jobs`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/indeed-alternative`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/linkedin-jobs-alternative`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${siteUrl}/eluta-alternative`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...careerHubEntries,
    {
      url: `${siteUrl}/about`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${siteUrl}/contact`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${siteUrl}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...companyEntries,
  ];
}
