/**
 * SearchPreferences → /jobs URL state (Meili retrieval rails).
 *
 * Deliberately separate from `defaultDigestSearchState` (email digest) — that
 * mapper intentionally skips location; this one uses the same country-only
 * path as résumé location (`deriveResumeLocationFacets`) plus work-mode
 * parsing from the prefs location string.
 */
import type { SearchPreferences } from "@/lib/agent/preferences";
import {
    EMPLOYMENT_TYPES,
    EXPERIENCE_LEVELS,
    POSTED_WITHIN_DAYS_OPTIONS,
    WORK_TYPES,
    postedWithinDaysToBucket,
    type EmploymentType,
    type ExperienceLevel,
    type PostedWithinDays,
    type WorkType,
} from "@/lib/agent/facets";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import { parseWorkTypeTokens } from "@/lib/jobs/query-understanding";
import { mergeFacets, type DerivedQuery } from "@/lib/jobs/resume-match";
import type { FacetKey } from "@/lib/jobs/types";
import { DEFAULT_URL_STATE, serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";

export interface PrefsToUrlOpts {
    /** Fallback when `prefs.location` is empty — typically résumé profile location. */
    resumeLocation?: string | null;
}

function isExperienceLevel(v: string): v is ExperienceLevel {
    return (EXPERIENCE_LEVELS as readonly string[]).includes(v);
}

function isEmploymentType(v: string): v is EmploymentType {
    return (EMPLOYMENT_TYPES as readonly string[]).includes(v);
}

function isWorkType(v: string): v is WorkType {
    return (WORK_TYPES as readonly string[]).includes(v);
}

function isPostedWithinDays(n: number): n is PostedWithinDays {
    return (POSTED_WITHIN_DAYS_OPTIONS as readonly number[]).includes(n);
}

/** Work mode from prefs: `workMode` wins, else `remoteOnly`, else tokens in `location`. */
export function workTypesFromSearchPreferences(prefs: SearchPreferences): string[] {
    if (prefs.workMode && isWorkType(prefs.workMode)) {
        return [prefs.workMode];
    }
    if (prefs.remoteOnly) {
        return parseWorkTypeTokens("remote").workTypes;
    }
    if (prefs.location?.trim()) {
        return parseWorkTypeTokens(prefs.location).workTypes;
    }
    return [];
}

/** Country facet from prefs location, with optional résumé fallback. Work-mode tokens stripped first. */
export function locationFacetsFromSearchPreferences(
    prefs: SearchPreferences,
    resumeLocation?: string | null,
): Partial<Record<FacetKey, string[]>> {
    const raw = (prefs.location?.trim() || resumeLocation?.trim() || "");
    if (!raw) return {};
    const { residualQ } = parseWorkTypeTokens(raw);
    const placeText = residualQ.trim() || raw;
    const derived = deriveResumeLocationFacets(placeText);
    return derived.location_country?.length ? { location_country: derived.location_country } : {};
}

/**
 * Turn agent search preferences (+ optional résumé location fallback) into
 * partial `/jobs` URL state — facets, salary, posted window. Does not set
 * `sort=fit`; Rank query phrases are merged separately.
 */
export function searchPreferencesToJobsUrlState(
    prefs: SearchPreferences,
    opts?: PrefsToUrlOpts,
): Partial<JobsUrlState> {
    const out: Partial<JobsUrlState> = {};
    const facets: Partial<Record<FacetKey, string[]>> = {};

    const q = prefs.query?.trim();
    if (q) out.q = q;

    const locationFacets = locationFacetsFromSearchPreferences(prefs, opts?.resumeLocation);
    Object.assign(facets, locationFacets);

    const workTypes = workTypesFromSearchPreferences(prefs);
    if (workTypes.length) facets.work_type = workTypes;

    const exp = prefs.experienceLevel?.trim();
    if (exp && isExperienceLevel(exp)) facets.experience_level = [exp];

    const emp = prefs.employmentType?.trim();
    if (emp && isEmploymentType(emp)) facets.employment_type = [emp];

    if (Object.keys(facets).length) out.facets = facets;

    if (typeof prefs.salaryMin === "number" && prefs.salaryMin > 0) {
        out.salaryMin = prefs.salaryMin;
    }

    if (prefs.postedWithinDays !== undefined && isPostedWithinDays(prefs.postedWithinDays)) {
        out.postedBucket = postedWithinDaysToBucket(prefs.postedWithinDays);
        out.postedExplicit = true;
    }

    return out;
}

/**
 * Prefs facets are retrieval rails; Rank phrases supply `q`. Prefs `query`
 * is used only when Rank produced an empty query (skills-only / thin résumé).
 * Explicit prefs facet keys override résumé-derived facets for the same key.
 */
export function mergePrefsWithRankPhrases(
    prefsPartial: Partial<JobsUrlState>,
    rank: DerivedQuery,
): Partial<JobsUrlState> {
    const prefsFacets = prefsPartial.facets ?? {};
    const rankFacets = rank.facets ?? {};
    const union = mergeFacets(rankFacets, prefsFacets);
    const mergedFacets: Partial<Record<FacetKey, string[]>> = { ...union };
    for (const key of Object.keys(prefsFacets) as FacetKey[]) {
        const fromPrefs = prefsFacets[key];
        if (fromPrefs?.length) mergedFacets[key] = fromPrefs;
    }

    const rankQ = rank.q.trim();
    const prefsQ = prefsPartial.q?.trim() ?? "";
    const q = rankQ || prefsQ;

    return {
        ...prefsPartial,
        q,
        facets: mergedFacets,
        sort: "fit",
    };
}

/** True when URL params match a cold `/jobs` visit (defaults only, no deliberate search). */
export function isPristineJobsUrlState(state: JobsUrlState): boolean {
    const normalized: JobsUrlState = {
        ...state,
        jobId: null,
        hideViewed: DEFAULT_URL_STATE.hideViewed,
    };
    return serializeJobsUrl(normalized) === serializeJobsUrl(DEFAULT_URL_STATE);
}

/** Cold landing or URL that only pins `sort=fit` — safe to merge prefs + auto-Rank. */
export function isAutoPersonalizeUrl(state: JobsUrlState): boolean {
    if (isPristineJobsUrlState(state)) return true;
    if (state.sort !== "fit") return false;
    return isPristineJobsUrlState({ ...state, sort: null });
}

/** Seed onboarding chips from résumé when agent prefs are not yet configured. */
export function draftSearchPreferencesFromResume(input: {
    location?: string | null;
    yearsOfExperience?: number;
    profession?: string | null;
}): SearchPreferences {
    const search: SearchPreferences = {};
    const loc = input.location?.trim();
    if (loc) {
        search.location = loc;
        const { workTypes } = parseWorkTypeTokens(loc);
        if (workTypes.includes("remote")) {
            search.workMode = "remote";
        }
    }
    if (input.profession?.trim()) search.query = input.profession.trim();
    const years = input.yearsOfExperience ?? 0;
    if (years > 6) search.experienceLevel = "senior";
    else if (years > 2) search.experienceLevel = "mid";
    else if (years > 0) search.experienceLevel = "entry";
    return search;
}
