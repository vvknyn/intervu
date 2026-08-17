/**
 * The tracker lane: companies the reader is actively going after, turned
 * into the same `FollowTarget` shape the followed-company lane already
 * searches with — so "new roles at a company you're pursuing" reuses
 * `listNewRolesForFollows` wholesale instead of growing a second
 * new-roles-by-domain mechanism.
 *
 * A pursuit records `company_name` (free text — the tracker lets someone
 * type a company for an interview that never came from a listing) and an
 * optional `job_id`, but NO domain. Resolving that free-text name against
 * indexed company names is exactly the failure that made `q=Harrods` return
 * a venue's concession roles on 2026-08-17: display names are not
 * identifiers. So the only accepted path from a pursuit to a domain is
 * `job_id` -> the listing itself, whose `company_domain` is the same field
 * the follows lane filters on.
 *
 * Pursuits with no `job_id` are therefore not covered. That gap is
 * deliberate and honest — an approximate match would put roles from the
 * wrong employer in someone's inbox, which is strictly worse than omitting
 * a company.
 *
 * `job_snapshot.apply_url` is NOT a shortcut around this: apply URLs point
 * at the ATS (`greenhouse.io`, `myworkdayjobs.com`), which is precisely the
 * "ATS portal hostname" case `displayCompany` exists to strip.
 */
import { getJobById } from "@/lib/jobs/get-job";
import { displayCompany } from "@/lib/jobs/presentation";
import { listPursuitsForUser } from "@/lib/pursuits/list";
import type { FollowTarget } from "@/lib/follows/list-new-roles";

/** How many tracker entries deep to look, newest-activity first. Bounds the
 *  Firestore read AND the per-pursuit listing lookups below. */
export const MAX_TRACKED_PURSUITS_SCANNED = 40;

/** Cap on companies this lane contributes, so a heavy tracker can't crowd
 *  out the follows and saved-search lanes in one email. */
export const MAX_TRACKED_COMPANIES = 10;

export interface TrackedCompanyCandidate {
  domain: string | null;
  displayName: string | null;
}

/** Same normalization `groupFollowAlertsByDomain` applies before matching a
 *  hit's `company_domain`. If these two ever disagree, a domain selected
 *  here would search fine and then match nothing on the way back. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

/**
 * Pure: which tracked companies earn a section, given what the reader
 * already follows.
 *
 * `excludeDomains` is the load-bearing argument. Following Stripe AND
 * tracking a Stripe role is the common case, not the exotic one, and
 * without this the reader gets the same roles twice under two different
 * headings — which reads as a broken email, not a thorough one.
 */
export function selectTrackedCompanies(input: {
  candidates: TrackedCompanyCandidate[];
  excludeDomains: Iterable<string>;
  cap?: number;
}): FollowTarget[] {
  const cap = input.cap ?? MAX_TRACKED_COMPANIES;
  const excluded = new Set([...input.excludeDomains].map(normalizeDomain));
  const picked = new Map<string, FollowTarget>();

  for (const candidate of input.candidates) {
    if (picked.size >= cap) break;
    const domain = candidate.domain ? normalizeDomain(candidate.domain) : "";
    if (!domain || excluded.has(domain) || picked.has(domain)) continue;
    // `displayCompany`, not a bare `name || domain`: a listing's company
    // field is external data and is sometimes an ATS portal hostname or a
    // bare domain placeholder, which that function already knows how to
    // repair against the domain. Reusing it keeps the digest's labels
    // consistent with what /jobs and /co render for the same company.
    picked.set(domain, { domain, displayName: displayCompany(candidate.displayName, domain) || domain });
  }

  return [...picked.values()];
}

/**
 * Thin I/O around `selectTrackedCompanies`.
 *
 * `getJobById` is deliberately NOT wrapped in a catch. It throws on a
 * non-2xx Meilisearch response precisely so an outage can't be read as "no
 * such job" (see its own doc comment), and swallowing that here would turn
 * a search outage into a silent, permanent-looking "you're tracking no
 * companies". A digest run must isolate failures PER USER so one unresolved
 * lookup can't abort the whole run.
 */
export async function listTrackedCompanies(
  uid: string,
  excludeDomains: Iterable<string>,
): Promise<FollowTarget[]> {
  const pursuits = await listPursuitsForUser(uid, { limit: MAX_TRACKED_PURSUITS_SCANNED });

  const jobIds = [...new Set(pursuits.map((p) => p.job_id).filter((id): id is string => Boolean(id)))];
  if (jobIds.length === 0) return [];

  const listings = await Promise.all(jobIds.map((id) => getJobById(id)));
  const candidates: TrackedCompanyCandidate[] = listings.map((job) => ({
    domain: job?.company_domain ?? null,
    displayName: job?.company ?? null,
  }));

  return selectTrackedCompanies({ candidates, excludeDomains });
}
