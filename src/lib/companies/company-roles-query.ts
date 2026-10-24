import { collapseDuplicatePostings } from "@/lib/companies/dedupe-postings";
import { resolveOpenCount, type OpenCount } from "@/lib/companies/open-count";
import { withoutNonPlaceLocation } from "@/lib/jobs/non-place-location";
import { isInternalPosting } from "@/lib/jobs/presentation";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";

/**
 * Hit window for a company's roles list. Named and exported because it is also the
 * saturation threshold `resolveOpenCount` needs — the count must know how
 * big the window was to know whether it filled up. It is NOT the count: that
 * conflation is exactly the bug this replaced.
 */
export const COMPANY_JOBS_FETCH_LIMIT = 200;

/** THE search a company's roles are read with: the company page and the name evidence behind
 *  every directory/hub list both build their query from this, so they cannot drift. */
export const companyRolesParams = (domain: string): JobSearchParams => ({
  companyDomain: domain,
  limit: COMPANY_JOBS_FETCH_LIMIT,
  hideGhosts: false,
});

/** Every field of a hit that {@link publicRoles} and `resolveCompanyName` read: `company` (the name), `title` (internal filter + dedupe key),
 *  `location*` (non-place cleanup + dedupe key) and `work_type` (`locationText`'s "Remote" fallback). Any reader that fetches hits for a
 *  company's roles asks for exactly these, so its count cannot differ from the page's. Keep it minimal: a wider payload took 199 s for 3600 domains on the box, this one 107 s for 4200 (2026-10-23). */
export const PUBLIC_ROLES_ATTRIBUTES = ["company", "title", "location", "location_city", "location_state", "location_country", "work_type"] as const;

/** The rows a company page shows (and its name is resolved from): non-place locations dropped, no internal postings, no duplicate postings. */
export const publicRoles = (hits: readonly PublicJob[]): PublicJob[] =>
  collapseDuplicatePostings(hits.map(withoutNonPlaceLocation).filter((job) => !isInternalPosting(job.title)));

/** THE open-roles number every surface shows for a company: the deduped public roles of its {@link companyRolesParams} read, exact or a floor. */
export const companyOpenCount = (result: Pick<JobSearchResult, "hits" | "total" | "facetDistribution" | "note" | "preview">): OpenCount =>
  resolveOpenCount(result, publicRoles(result.hits).length, COMPANY_JOBS_FETCH_LIMIT);
