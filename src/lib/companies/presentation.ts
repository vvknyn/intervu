/**
 * How `/co/[slug]` states its own numbers and declares itself to crawlers.
 *
 * Same split `lib/jobs/presentation.ts` established for the job surfaces: the
 * page file renders, this file decides. It exists as a module rather than as
 * helpers inside `app/co/[slug]/page.tsx` because Next type-checks page files
 * against a fixed export list (`next-types-plugin` — any export that isn't
 * `default`/`generateMetadata`/a route-segment config is a build error), so a
 * helper that lives in the page file is a helper no unit test can reach.
 */
import type { Metadata } from "next";
import { isCompanyIndexable } from "./indexable";
import { companyBoardPath } from "./paths";
import type { CompanyPageData } from "./types";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

/**
 * The open-role count as a string, everywhere the page shows it.
 *
 * `openCount` prefers the indexed `company_open_count` aggregate and falls
 * back to what the search actually returned; `openCountIsLowerBound` marks
 * the cases where that number is a floor rather than a total. A floor
 * rendered as a bare integer claims a precision the page doesn't have, so it
 * renders as `N+`. One helper, so the KPI tile, the roles-list caption and
 * the footer CTA cannot end up disagreeing about how exact the same number is.
 */
export function openCountText(
  data: Pick<CompanyPageData, "openCount" | "openCountIsLowerBound">,
): string {
  return data.openCountIsLowerBound ? `${data.openCount}+` : String(data.openCount);
}

/**
 * Does `ghostFlaggedPct` actually describe every counted role, or only the
 * fetched window?
 *
 * `ghostFlaggedPct` is a share of `jobs` — at most `COMPANY_JOBS_FETCH_LIMIT`
 * roles — while the page presents it next to a company-wide `openCount`. When
 * the window is smaller than the count, that percentage is a sample being
 * read as a census. Derived from the two numbers the page already has rather
 * than from a new field, so this needs no contract change: it is exactly the
 * condition under which the sample is partial.
 */
export function ghostPctCoversAllRoles(
  data: Pick<CompanyPageData, "jobs" | "openCount">,
): boolean {
  return data.jobs.length >= data.openCount;
}

/** Real page data only — degrades to a generic line when there are zero open
 *  roles rather than fabricating a count, and says "at least" rather than
 *  stating a floor as a total. */
export function companyMetaDescription(data: CompanyPageData): string {
  if (data.openCount > 0) {
    const roles = data.openCount === 1 ? "role" : "roles";
    const count = data.openCountIsLowerBound ? `at least ${data.openCount}` : String(data.openCount);
    return `${data.name} has ${count} live, verified open ${roles} tracked on intervu, screened for ghost-job risk.`;
  }
  return `Track live verified job postings and ghost-job risk signals for ${data.name} on intervu.`;
}

/**
 * Everything `/co/[slug]` tells a crawler about itself. Pure, so both
 * branches of the robots decision are unit-testable without a live index.
 *
 * The canonical is UNCONDITIONAL. `/co/[slug]` shipped with no `rel=canonical`
 * at all (verified on prod 2026-08-11: `/jobs/<slug>` and `/jobs` both emit
 * one, `/co/stripe--com` emitted none) while three things were true at once —
 * the site moved intervu.cc → intervuhq.com on 2026-08-08, `/companies/[slug]`
 * `redirect()`s onto this route, and the same company is reachable through
 * both. A page that declines to say which URL it is leaves that to the
 * crawler. `noindex` does not make the question moot either: a de-indexed
 * page still consolidates signals onto whatever URL it names, which is why
 * this is built before the robots decision rather than inside its `else`.
 *
 * `follow` is retained on the noindex branch on purpose — the roles list
 * links to real `/jobs/<slug>` pages that ARE indexable, and an empty company
 * page is still a legitimate path to them.
 */
export function buildCompanyPageMetadata(data: CompanyPageData): Metadata {
  const title = `Is ${data.name} hiring? Live verified jobs & ghost-job risk`;
  const description = companyMetaDescription(data);
  return {
    title,
    description,
    ...canonicalMetadata(companyBoardPath(data.domain), title, description),
    ...(isCompanyIndexable(data) ? {} : { robots: { index: false, follow: true } }),
  };
}
