/**
 * A personal pack IS a `/jobs` filter state — same schema (`JobsUrlState`),
 * same search call, no pack-only predicates. Whatever a candidate would get
 * by applying these filters by hand on `/jobs` is what the pack retrieves;
 * fit only reorders the result (rank-for-you). `jobsBoardHref` (url-state.ts) is the
 * link that lands them on `/jobs` with exactly this state.
 */
import { candidateCountries, preferredRoles, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { buildMatchQuery, experienceLevelFacet } from "@/lib/jobs/resume-match";
import { searchParamsFromUrlState } from "@/lib/jobs/search-payload";
import { DEFAULT_URL_STATE, PACK_POSTED_BUCKET, type JobsUrlState } from "@/lib/jobs/url-state";
import type { JobSearchParams, PostedBucket } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/**
 * Resolved signals → the filter state that retrieves this candidate's pack.
 * A signal that is unknown adds no filter (unknown is not "anywhere the
 * search default decides"): no location known → no location facet.
 */
export function packFilters(resume: ResumeData, signals: CandidateSignals): JobsUrlState {
    // Roles they said they want lead the search; the résumé fills the rest (`buildMatchQuery`).
    const { q, facets: derived } = buildMatchQuery(resume, undefined, preferredRoles(signals));
    const facets = { ...derived };
    // A stated "mid" retrieves Senior too when the résumé shows a long career that led people or work: it widens what
    // is read, never the level scoring holds them to. Vivek's Settings said mid beside 13 years with lead roles, and the
    // pack read 32 rows (2026-10-14).
    const levels = experienceLevelFacet(signals.seniority.value, resume);
    if (levels) facets.experience_level = levels;
    const countries = candidateCountries(signals);
    if (countries.length > 0) facets.location_country = countries;
    if (signals.remotePreference.value) facets.work_type = ["remote"];
    return { ...DEFAULT_URL_STATE, postedBucket: packPostedBucket(signals), q, facets, sort: "fit" };
}

/**
 * The pack's posted window: what they chose in Settings › Posted within
 * (7, 30 or 90 days), else `PACK_POSTED_BUCKET`. The choice used to be saved
 * and read only by their agent's searches.
 */
export function packPostedBucket(signals: Pick<CandidateSignals, "postedWithinDays">): PostedBucket {
    const days = signals.postedWithinDays?.value;
    if (days == null) return PACK_POSTED_BUCKET;
    if (days <= 1) return "1d";
    if (days <= 3) return "3d";
    if (days <= 7) return "7d";
    if (days <= 30) return "30d";
    return "90d";
}

/** The exact `searchJobsAction` params `/jobs` sends for this pack's filters. */
export function packSearchParams(filters: JobsUrlState): JobSearchParams {
    return searchParamsFromUrlState(filters);
}
