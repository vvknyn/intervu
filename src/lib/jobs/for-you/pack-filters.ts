/**
 * A personal pack IS a `/jobs` filter state — same schema (`JobsUrlState`),
 * same search call, no pack-only predicates. Whatever a candidate would get
 * by applying these filters by hand on `/jobs` is what the pack retrieves;
 * fit only reorders the result (rank-for-you). `jobsBoardHref` (url-state.ts) is the
 * link that lands them on `/jobs` with exactly this state.
 */
import { candidateCountries, preferredRoles, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { buildMatchQuery, experienceLevelFacet, withLeadTitle } from "@/lib/jobs/resume-match";
import { contentPhrasesFor } from "@/lib/jobs/for-you/content-phrases";
import { parseQuotedOrPhrases } from "@/lib/jobs/fit-phrases";
import { packContentMark, resumeSearchMark, searchParamsFromUrlState } from "@/lib/jobs/search-payload";
import { DEFAULT_URL_STATE, PACK_POSTED_BUCKET, type JobsUrlState } from "@/lib/jobs/url-state";
import type { JobSearchParams, PostedBucket } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

/**
 * How many of the roles a pack's search found its list reads and scores: the deck's first page, the hub's last count
 * probe and its tiles, the fit-sorted Search list and For-you over MCP. The first `FOR_YOU_POOL_WINDOW` (150) are
 * composed as the pool (meilisearch.ts); the rest are the title lanes' next rows. At 150, a 13-year PM's pack read 150
 * of 226 found and the 76 it never scored were mostly Product Manager titles (2026-10-17: "just 14 roles?").
 */
export const FOR_YOU_READ_DEPTH = 300;

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
    // A pack that retrieves senior roles also asks for its title's lead name ("Product Lead" beside "Product
    // Manager"): a listing calls the same senior job either way, and a title phrase finds only its own words.
    const titles = levels?.includes("senior") ? withLeadTitle(q) : q;
    return { ...DEFAULT_URL_STATE, postedBucket: packPostedBucket(signals), q: titles, facets, sort: "fit" };
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

/**
 * The exact `searchJobsAction` params `/jobs` sends for this pack's filters: marked as a résumé's own list
 * (`resumeSearchMark`), which also leaves roles past Senior out of the pool unless `signals` show the
 * résumé holds one. Every pack search (the deck, the hub's counts, Today, For-you over MCP) shares this.
 *
 * With `content`, the search also looks for what the résumé's skills show in a posting's whole text, so the
 * pool is not only the roles whose title the résumé names (`packContentMark`). A deck and the agent's
 * `for_you` also ask for remote roles that name no country (`unplacedRemote`), which they list last with
 * the caveat; Today and the daily picks do not.
 */
export function packSearchParams(
    filters: JobsUrlState,
    signals?: Pick<CandidateSignals, "seniority">,
    content?: { resume: ResumeData; unplacedRemote?: boolean },
): JobSearchParams {
    const base = { ...searchParamsFromUrlState(filters), ...resumeSearchMark(true, false, signals?.seniority.pastSenior === true) };
    if (!content) return base;
    return { ...base, ...packContentMark(packContentPhrases(content.resume, filters.q), content.unplacedRemote === true) };
}

/** The content phrases a pack's search adds: the résumé's skills, minus the words of the title phrases the search already carries. */
export function packContentPhrases(resume: ResumeData, q: string | null | undefined): string[] {
    const text = (q ?? "").trim();
    const phrases = parseQuotedOrPhrases(text) ?? (text ? [text.replace(/"/g, "")] : []);
    return contentPhrasesFor(resume, phrases);
}
