/**
 * `searchJobs` as the site's own server serves it to a person, for the MCP
 * tools. The site does two reads after the bare search that the tools
 * skipped, so the same role could read differently to a connected AI than on
 * velai.app:
 *  - A list's rows carry what each description says about where the person
 *    must be (`withPlaceRestrictions`, as `searchJobsAction` adds it), so
 *    "Remote, must be based in India" is labelled "Outside Canada" for a
 *    candidate in Canada rather than "Country unclear".
 *  - An id lookup goes through the job pane's own seam
 *    (`hydrateJobDescription`: a teaser description is filled from the live
 *    posting before it is returned), then the whole description's place
 *    (`withDescriptionPlace`, as the job page reads it).
 *
 * The site's browser reads the rows its 250 ms place read missed
 * (`/api/jobs/place-notes`); an agent has no such second chance, so its read
 * waits `AGENT.PLACE_READ_DEADLINE_MS` instead.
 */
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import { AGENT } from "./config";

export interface SiteSearchDeps {
    search: (params: JobSearchParams) => Promise<JobSearchResult>;
    hydrate: (id: string) => Promise<JobSearchResult>;
    rowPlaces: (hits: PublicJob[], opts: { deadlineMs: number }) => Promise<PublicJob[]>;
    wholePlace: (job: PublicJob) => PublicJob;
    /** A résumé-ranked list's rows with their descriptions' requirement and duty terms (`withJdTerms`), as `searchJobsAction` adds them. Optional: a caller without it scores titles only. */
    rowTerms?: (hits: PublicJob[], opts: { deadlineMs: number }) => Promise<PublicJob[]>;
}

export function siteSearch(deps: SiteSearchDeps): (params: JobSearchParams) => Promise<JobSearchResult> {
    return async (params) => {
        if (params.id) {
            const found = await deps.hydrate(params.id);
            if (found.unavailable === true || !found.configured) return found;
            return { ...found, hits: found.hits.map(deps.wholePlace) };
        }
        const result = await deps.search(params);
        if (result.unavailable === true || !result.configured || result.hits.length === 0) return result;
        const [placed, termed] = await Promise.all([
            deps.rowPlaces(result.hits, { deadlineMs: AGENT.PLACE_READ_DEADLINE_MS }),
            params.fromResume && deps.rowTerms ? deps.rowTerms(result.hits, { deadlineMs: AGENT.PLACE_READ_DEADLINE_MS }) : null,
        ]);
        const hits = termed
            ? placed.map((hit, i) => (termed[i]?.jd_terms !== undefined ? { ...hit, jd_terms: termed[i]!.jd_terms } : hit))
            : placed;
        return { ...result, hits };
    };
}
