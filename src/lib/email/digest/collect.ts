/**
 * Thin I/O layer: gathers one user's follows + saved searches, asks the
 * EXISTING "what's new since a cursor" mechanisms for each (never
 * reimplemented — `listNewRolesForFollows` already backs the in-app
 * FollowAlertsCard; `listNewRolesForSavedSearch` is `saved-search-
 * new-roles.ts`'s search-direct sibling of `countNewSinceAction`'s saved
 * scope), and hands the raw sections to the pure `assembleDigest`.
 */
import { followedCompaniesCollection, docToFollowedCompany } from "@/lib/follows/store";
import { savedSearchesCollection, docToSavedSearch } from "@/lib/jobs/saved-searches-store";
import { listNewRolesForFollows } from "@/lib/follows/list-new-roles";
import { JOBS_FETCHED_PER_FOLLOW_DOMAIN } from "@/lib/follows/alerts";
import {
  listNewRolesForSavedSearch,
  JOBS_FETCHED_PER_SAVED_SEARCH,
} from "@/lib/jobs/saved-search-new-roles";
import { jobsUrlStateFromSavedHref } from "@/lib/jobs/saved-searches";
import { jobPath } from "@/lib/jobs/job-slug";
import type { PublicJob } from "@/lib/jobs/types";
import { getSiteUrl } from "@/lib/seo/constants";
import { getDigestCursor } from "../digest-cursor";
import { assembleDigest, type DigestModel, type DigestSectionItem, type RawDigestSection } from "./assemble";

function toSectionItem(job: PublicJob, siteUrl: string): DigestSectionItem {
  return {
    title: job.title,
    company: job.company ?? "Unknown company",
    href: `${siteUrl}${jobPath(job)}`,
  };
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
    const slugByDomain = new Map(follows.map((f) => [f.domain, f.slug]));
    const groups = await listNewRolesForFollows(sinceIso, follows);
    for (const group of groups) {
      sections.push({
        kind: "followed-company",
        name: group.displayName,
        items: group.jobs.map((job) => toSectionItem(job, siteUrl)),
        mayHaveMore: group.jobs.length >= JOBS_FETCHED_PER_FOLLOW_DOMAIN,
        seeAllHref: `${siteUrl}/co/${slugByDomain.get(group.domain) ?? group.domain}`,
      });
    }
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

  // Empty sections (nothing new for that follow/search) are dropped inside
  // assembleDigest itself — not duplicated here, so there's exactly one
  // place that decides "does this section earn a spot in the email."
  return assembleDigest({ sections, unsubscribeUrl });
}
