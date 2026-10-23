import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
  title: "Companies hiring hard",
  description: "Elite companies ranked by roles opened in the last 90 days.",
  ...robotsMetadataFor("/companies/hiring"),
  alternates: { canonical: "/jobs" },
};

export const revalidate = 3600;

/**
 * TEMPORARILY DOWN — redirected to /jobs 2026-08-02, nav entry removed
 * (nav-tabs.tsx). Two root causes, verified live against meili-box that day:
 *   1. `company_domain` is not in the index's `filterableAttributes`, so
 *      `fetchEliteBoardJobHits`'s `board:"elite"` query errors.
 *   2. WORSE: `company_opened_90d` / `company_open_count` don't exist on the
 *      indexed documents at all yet. Even with (1) fixed, `rankHotCompanies`
 *      would drop every row (it requires `opened90d` to be a number), so the
 *      page would silently rank by whatever order the fetched sample
 *      happened to come back in while its subtitle still claims "Ranked by
 *      roles opened in the last 90 days" — a wrong page that LOOKS correct.
 * The render tree this used to redirect from (`HotCompaniesPage`,
 * `getHotCompaniesList` from `@/lib/companies/hot-list`) was deleted here
 * (data-surfaces redesign, §04 D3) as dead code — nothing else in the repo
 * imported it (tests/unit/hot-list.test.ts covers the list-building logic
 * directly, not this page). If the two Meili gaps above ever get fixed,
 * restore the render tree from git history rather than un-deleting an
 * export; don't just flip this redirect back on without it.
 */
export default function HotCompaniesRedirect() {
  redirect("/jobs");
}
