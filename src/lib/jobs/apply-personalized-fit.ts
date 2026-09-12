/**
 * Shared Rank + agent_preferences merge — used by /jobs auto-personalize and
 * manual "Rank by fit".
 */
import type { SearchPreferences } from "@/lib/agent/preferences";
import { LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import {
    buildMatchQuery,
    mergeFacets,
} from "@/lib/jobs/resume-match";
import {
    mergePrefsWithRankPhrases,
    searchPreferencesToJobsUrlState,
} from "@/lib/jobs/prefs-to-url-state";
import type { FacetKey } from "@/lib/jobs/types";
import type { JobsUrlState } from "@/lib/jobs/url-state";
import type { ResumeData } from "@/types/resume";

export interface PersonalizedFitResult {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    sort: "fit";
}

/** Rank query + prefs rails + résumé location fallback (mirrors page `applyFit`). */
export function personalizedFitFromResume(
    resume: ResumeData,
    prefs: SearchPreferences | undefined,
    currentFacets: Partial<Record<FacetKey, string[]>>,
): PersonalizedFitResult {
    const rank = buildMatchQuery(resume, { openToAdjacentRoles: prefs?.openToAdjacentRoles });
    const prefsState = searchPreferencesToJobsUrlState(prefs ?? {}, {
        resumeLocation: resume.profile?.location,
    });
    const fromPrefsAndRank = mergePrefsWithRankPhrases(prefsState, rank);

    const userPickedLocation = LOCATION_FACET_FIELDS.some((field) => (currentFacets[field] ?? []).length > 0);
    const derived = fromPrefsAndRank.facets ?? {};
    const derivedWithLocation = userPickedLocation
        ? derived
        : { ...derived, ...deriveResumeLocationFacets(resume.profile?.location) };
    const merged = mergeFacets(currentFacets, derivedWithLocation);

    return {
        q: fromPrefsAndRank.q ?? "",
        facets: merged,
        sort: "fit",
    };
}

/** Prefs-only rails when there is no usable résumé for Rank phrases. */
export function prefsOnlyJobsState(prefs: SearchPreferences): Partial<JobsUrlState> {
    return searchPreferencesToJobsUrlState(prefs);
}
