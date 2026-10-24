import { collapseDuplicatePostings } from "@/lib/companies/dedupe-postings";
import { isInternalPosting } from "@/lib/jobs/presentation";
import type { JobSearchParams, PublicJob } from "@/lib/jobs/types";

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

/** The rows a company page shows (and its name is resolved from): no internal postings, no duplicate postings. */
export const publicRoles = (hits: readonly PublicJob[]): PublicJob[] =>
  collapseDuplicatePostings(hits.filter((job) => !isInternalPosting(job.title)));
