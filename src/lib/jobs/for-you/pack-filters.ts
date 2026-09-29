/**
 * A personal pack IS a `/jobs` filter state — same schema (`JobsUrlState`),
 * same search call, no pack-only predicates. Whatever a candidate would get
 * by applying these filters by hand on `/jobs` is what the pack retrieves;
 * fit only reorders the result (rank-for-you). `jobsBoardHref` (url-state.ts) is the
 * link that lands them on `/jobs` with exactly this state.
 */
import { candidateCountries, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { buildMatchQuery, experienceLevelFacet } from "@/lib/jobs/resume-match";
import { searchParamsFromUrlState } from "@/lib/jobs/search-payload";
import { DEFAULT_URL_STATE, type JobsUrlState } from "@/lib/jobs/url-state";
import type { JobSearchParams } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/**
 * Resolved signals → the filter state that retrieves this candidate's pack.
 * A signal that is unknown adds no filter (unknown is not "anywhere the
 * search default decides"): no location known → no location facet.
 */
export function packFilters(resume: ResumeData, signals: CandidateSignals): JobsUrlState {
    const { q, facets: derived } = buildMatchQuery(resume);
    const facets = { ...derived };
    const levels = experienceLevelFacet(signals.seniority.value);
    if (levels) facets.experience_level = levels;
    const countries = candidateCountries(signals);
    if (countries.length > 0) facets.location_country = countries;
    if (signals.remotePreference.value) facets.work_type = ["remote"];
    return { ...DEFAULT_URL_STATE, q, facets, sort: "fit" };
}

/** The exact `searchJobsAction` params `/jobs` sends for this pack's filters. */
export function packSearchParams(filters: JobsUrlState): JobSearchParams {
    return searchParamsFromUrlState(filters);
}
