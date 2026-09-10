/**
 * Thin I/O layer: gathers one user's follows + saved searches, asks the
 * EXISTING "what's new since a cursor" mechanisms for each (never
 * reimplemented — `listNewRolesForFollows` already backs the in-app
 * FollowAlertsBell; `listNewRolesForSavedSearch` is `saved-search-
 * new-roles.ts`'s search-direct sibling of `countNewSinceAction`'s saved
 * scope), and hands the raw sections to the pure `assembleDigest`.
 */
import { followedCompaniesCollection, docToFollowedCompany } from "@/lib/follows/store";
import { savedSearchesCollection, docToSavedSearch } from "@/lib/jobs/saved-searches-store";
import { listNewRolesForFollows } from "@/lib/follows/list-new-roles";
import { JOBS_FETCHED_PER_FOLLOW_DOMAIN, type FollowAlertGroup } from "@/lib/follows/alerts";
import {
  listNewRolesForSavedSearch,
  JOBS_FETCHED_PER_SAVED_SEARCH,
} from "@/lib/jobs/saved-search-new-roles";
import { jobsUrlStateFromSavedHref } from "@/lib/jobs/saved-searches";
import { serializeJobsUrl } from "@/lib/jobs/url-state";
import { jobPath } from "@/lib/jobs/job-slug";
import { decodeText, displayCompanyBrand, locationText, titleCaseDisplay } from "@/lib/jobs/presentation";
import { domainToSlug } from "@/lib/boards/slug";
import { getAgentPreferences } from "@/lib/agent/preferences";
import type { PublicJob } from "@/lib/jobs/types";
import { getSiteUrl } from "@/lib/seo/constants";
import { getDigestCursor } from "../digest-cursor";
import { listTrackedCompanies } from "./tracked-companies";
import { isDefaultDigestEnabled, defaultDigestSearchState, DEFAULT_SECTION_NAME } from "./default-section";
import {
  assembleDigest,
  type DigestModel,
  type DigestSectionItem,
  type DigestSectionKind,
  type RawDigestSection,
} from "./assemble";

export function toSectionItem(job: PublicJob, siteUrl: string): DigestSectionItem {
  return {
    title: titleCaseDisplay(decodeText(job.title)),
    // The index carries the ATS-stated raw name (intervu owns display-time
    // cleaning, not ingest) — `digest.ts` prints `item.company` straight into
    // the sent HTML/text email, so it needs the same chain the SERP/detail
    // panes apply, not the raw corpus string this used to pass through.
    company: displayCompanyBrand(job.company, job.company_domain, job.title) || "Unknown company",
    href: `${siteUrl}${jobPath(job)}`,
    // The site's own formatter, not a second one: it already handles the
    // "Remote ·" prefix, multi-country arrays, and the "[object Object]"
    // junk class the corpus carries in both the free-text and structured
    // location fields.
    location: locationText(job),
  };
}

/**
 * Both company-shaped lanes (followed and tracked) search by domain and
 * group identically — they differ only in why the company is here and in
 * where the slug for its /co link comes from. Kept as one function so the
 * two can never drift on item mapping or on the `mayHaveMore` floor.
 *
 * Exported: the PG-backed email-only follower lane (`pg-lane.ts`) builds
 * the exact same "followed-company" section shape for its recipients and
 * reuses this rather than re-deriving the mapping a third time.
 */
export function companyGroupsToSections(input: {
  groups: FollowAlertGroup[];
  kind: Extract<DigestSectionKind, "followed-company" | "tracked-company">;
  slugForDomain: (domain: string) => string;
  siteUrl: string;
}): RawDigestSection[] {
  return input.groups.map((group) => ({
    kind: input.kind,
    name: group.displayName,
    items: group.jobs.map((job) => toSectionItem(job, input.siteUrl)),
    mayHaveMore: group.jobs.length >= JOBS_FETCHED_PER_FOLLOW_DOMAIN,
    seeAllHref: `${input.siteUrl}/co/${input.slugForDomain(group.domain)}`,
  }));
}

export async function collectDigestForUser(uid: string, unsubscribeUrl: string): Promise<DigestModel | null> {
  const siteUrl = getSiteUrl();
  const sinceIso = await getDigestCursor(uid);

  const [followSnap, searchSnap] = await Promise.all([
    followedCompaniesCollection(uid).get(),
    savedSearchesCollection(uid).get(),
  ]);
  const follows = followSnap.docs.map(docToFollowedCompany);
  const savedSearches = searchSnap.docs.map(docToSavedSearch);

  const sections: RawDigestSection[] = [];

  if (follows.length > 0) {
    // A follow document stores its own slug, so prefer it over deriving one:
    // it is what /co actually linked when the reader followed the company.
    const slugByDomain = new Map(follows.map((f) => [f.domain, f.slug]));
    sections.push(
      ...companyGroupsToSections({
        groups: await listNewRolesForFollows(sinceIso, follows),
        kind: "followed-company",
        slugForDomain: (domain) => slugByDomain.get(domain) ?? domain,
        siteUrl,
      }),
    );
  }

  // Excludes anything already followed, so a company the reader both
  // follows and is tracking appears once, under the stronger reason.
  const tracked = await listTrackedCompanies(
    uid,
    follows.map((f) => f.domain),
  );
  if (tracked.length > 0) {
    sections.push(
      ...companyGroupsToSections({
        groups: await listNewRolesForFollows(sinceIso, tracked),
        kind: "tracked-company",
        slugForDomain: domainToSlug,
        siteUrl,
      }),
    );
  }

  const savedSearchSections = await Promise.all(
    savedSearches.map(async (search): Promise<RawDigestSection> => {
      const state = jobsUrlStateFromSavedHref(search.href);
      const jobs = await listNewRolesForSavedSearch(sinceIso, state);
      return {
        kind: "saved-search",
        name: search.name,
        items: jobs.map((job) => toSectionItem(job, siteUrl)),
        mayHaveMore: jobs.length >= JOBS_FETCHED_PER_SAVED_SEARCH,
        seeAllHref: `${siteUrl}${search.href}`,
      };
    }),
  );
  sections.push(...savedSearchSections);

  // The no-signal lane, and only for readers who genuinely have no signal.
  // Gated on the SOURCES being empty rather than on `sections` being empty:
  // a reader whose saved search simply had a quiet week has told us exactly
  // what they want, and answering that with a generic section would be a
  // worse email than the no-email `assembleDigest` is about to return.
  if (isDefaultDigestEnabled() && follows.length === 0 && savedSearches.length === 0 && tracked.length === 0) {
    const preferences = await getAgentPreferences(uid);
    const state = defaultDigestSearchState(preferences.search);
    const jobs = await listNewRolesForSavedSearch(sinceIso, state);
    sections.push({
      kind: "default",
      name: DEFAULT_SECTION_NAME,
      items: jobs.map((job) => toSectionItem(job, siteUrl)),
      mayHaveMore: jobs.length >= JOBS_FETCHED_PER_SAVED_SEARCH,
      seeAllHref: `${siteUrl}/jobs${serializeJobsUrl(state)}`,
    });
  }

  // Empty sections (nothing new for that follow/search) are dropped inside
  // assembleDigest itself — not duplicated here, so there's exactly one
  // place that decides "does this section earn a spot in the email."
  return assembleDigest({ sections, unsubscribeUrl, siteUrl });
}
