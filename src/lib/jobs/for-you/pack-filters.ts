/**
 * A personal pack IS a `/jobs` filter state — same schema (`JobsUrlState`),
 * same search call, no pack-only predicates. Whatever a candidate would get
 * by applying these filters by hand on `/jobs` is what the pack retrieves;
 * fit only reorders the result (rank-for-you). `jobsBoardHref` (url-state.ts) is the
 * link that lands them on `/jobs` with exactly this state.
 */
import { candidateCountries, preferredRoles, resolveCandidateSignals, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import type { AgentPreferences } from "@/lib/agent/preferences";
import { LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";
import { buildMatchQuery, experienceLevelFacet, mergeFacets, withLeadTitle } from "@/lib/jobs/resume-match";
import { contentPhrasesFor } from "@/lib/jobs/for-you/content-phrases";
import { parseQuotedOrPhrases } from "@/lib/jobs/fit-phrases";
import { packContentMark, resumeSearchMark, searchParamsFromUrlState } from "@/lib/jobs/search-payload";
import { DEFAULT_URL_STATE, PACK_POSTED_BUCKET, serializeJobsUrl, type JobsUrlState } from "@/lib/jobs/url-state";
import type { FacetKey, JobSearchParams, PostedBucket } from "@/lib/jobs/types";
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
    // The résumé's level ranks roles (band order, the "level" left-out reason), it never filters them: only a level
    // the person picks in Filters does (Vivek, 2026-10-22: "return all search results ranked by relevance and fit").
    // `levels` only decides whether the title search also asks for the lead name below.
    const levels = experienceLevelFacet(signals.seniority.value, resume);
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

/** What the résumé's fit ranking sets on the board. */
export interface FitApplication {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    postedBucket: PostedBucket | undefined;
    /** The visitor pinned a Posted window by hand: the fit leaves it theirs. */
    keepUserWindow: boolean;
}

/**
 * The résumé's pack filters laid over the board's current ones: the same state "Edit filters" opens the board on,
 * so fit-ranking the board and applying the pack by hand return the same rows. A place the user already picked is
 * theirs, never replaced by the résumé's; a Posted window they pinned stays theirs. The one computation behind
 * the client's `applyFit` and the server's signed-in redirect (`fitEntryPath`), so both land on the same address.
 */
export function fitApplication(
    resume: ResumeData,
    agentPrefs: AgentPreferences | null | undefined,
    current: { facets: Partial<Record<FacetKey, string[]>>; postedExplicit: boolean },
): FitApplication {
    const { q, facets: packFacets, postedBucket } = packFilters(resume, resolveCandidateSignals(resume, agentPrefs));
    const derived = { ...packFacets };
    if (LOCATION_FACET_FIELDS.some((field) => (current.facets[field] ?? []).length > 0)) {
        for (const field of LOCATION_FACET_FIELDS) delete derived[field];
    }
    return { q, facets: mergeFacets(current.facets, derived), postedBucket, keepUserWindow: current.postedExplicit };
}

/** `base` with the fit applied: its query and facets, `sort=fit`, and the pack's window unless the visitor pinned one. */
export function fitUrlState(base: JobsUrlState, fit: FitApplication): JobsUrlState {
    return {
        ...base,
        q: fit.q,
        facets: fit.facets,
        sort: "fit",
        ...(fit.keepUserWindow ? {} : { postedBucket: fit.postedBucket, postedExplicit: true }),
    };
}

/**
 * Whether the address already asks for something of its own (a query, a company or board scope, a job, any filter;
 * anything but a sort): fitting then ranks it as it stands, never replaces or widens it with the résumé's pack.
 */
export function urlHasOwnIntent(base: JobsUrlState): boolean {
    return serializeJobsUrl({ ...base, sort: null }) !== "";
}

/** Rank by fit from `base`: an address with its own intent stays as is and only gains `sort=fit`; a bare board takes the pack (`fitUrlState`). */
export function fitRankUrlState(base: JobsUrlState, fit: FitApplication): JobsUrlState {
    return urlHasOwnIntent(base) ? { ...base, sort: "fit" } : fitUrlState(base, fit);
}
