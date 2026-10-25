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
 *   2. WORSE: the company 90-day aggregates and `company_open_count` do not exist on the
 *      indexed documents at all yet. Even with (1) fixed, `rankHotCompanies`
 *      would drop every row (it required a numeric 90-day count), so the
 *      page would silently rank by whatever order the fetched sample
 *      happened to come back in while its subtitle still claims "Ranked by
 *      roles opened in the last 90 days" — a wrong page that LOOKS correct.
 * The render tree this used to redirect from (`HotCompaniesPage`,
 * `getHotCompaniesList` from `lib/companies/hot-list`) was deleted here
 * (data-surfaces redesign, §04 D3) as dead code, and `hot-list.ts` itself
 * with it once nothing imported it. If the two Meili gaps above ever get
 * fixed, restore the render tree from git history; don't just flip this
 * redirect back on without it.
 */
export default function HotCompaniesRedirect() {
  redirect("/jobs");
}
