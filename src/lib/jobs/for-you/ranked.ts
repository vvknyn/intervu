/**
 * For-you ranking — pure candidate composition + ordering, browser-safe (no
 * server-only import may ever land here; `search` is injected precisely so
 * this never reaches for an MCP-only or server-only search implementation
 * directly).
 *
 * A pack IS a `/jobs` filter state (`packFilters`, ./pack-filters.ts): the
 * search call is exactly the one `/jobs` sends for those filters, so the ids
 * a candidate gets by applying them by hand are the ids returned here. Fit
 * only REORDERS that result, in `orderForYouJobsByBand`'s order (`forYouSortKey`, the one order every
 * recommending list shares): age, reach, fit band, then what the posting asks for that the résumé shows.
 * A recommendation list is not a
 * search: a role the résumé could not take (`deckLeftOut`: above their level, asks for what the
 * résumé doesn't show, a different kind of role, outside where they can work, posted over 30 days ago) is left out,
 * and `leftOut` counts each reason, so every row of the search is either listed or accounted for.
 *
 * Scoring/reasons pairing goes through the ONE fit chokepoint (`fitFor`,
 * ./fit.ts) — this module never calls `scoreJobAgainstResume` or
 * `inferReasons` itself.
 */
import { resolveCandidateSignals, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { packFilters, packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import { deckListFor, withListRemovals, type DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import { fitFor } from "@/lib/jobs/for-you/fit";
import { targetTitlesFromQuery, jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { decodeText } from "@/lib/jobs/presentation";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { LocationReport } from "@/lib/jobs/broaden";
import type { JobsUrlState } from "@/lib/jobs/url-state";
import type { MatchScore } from "@/lib/match/score";
import type { InferReasonsResult } from "@/lib/jobs/for-you/infer-reasons";
import type { ResumeData } from "@/types/resume";

export interface RankedHit {
    job: PublicJob;
    match: MatchScore | null;
    fit_reasons: InferReasonsResult | null;
    group: "target_title" | "adjacent";
}

export interface RankForYouResult {
    hits: RankedHit[];
    /** What the pool read (`considered`, of the `found` the search reported when more) and the list left out, by reason (the rows of `hits` are the rest). */
    leftOut: DeckLeftOutSummary;
    query_used: string;
    /** The filter state the pack retrieved with — the same one `/jobs` opens on
     *  (`jobsBoardHref`, url-state.ts). */
    filters: JobsUrlState;
    /** Mirrors `SearchOut`'s unavailable/note pair (agent/tools.ts) — a real
     *  backend failure, never a true zero-match ranked list. */
    unavailable?: boolean;
    note?: string;
    /** The search's places that named nothing it could filter on
     *  (`JobSearchResult.unmatchedPlaceMentions`), for `locationDropped`. */
    unmatchedPlaceMentions?: string[];
}

export interface RankForYouParams {
    resume: ResumeData;
    search: (params: JobSearchParams) => Promise<JobSearchResult>;
    /** Candidate pool size fetched from `search` before ranking/paging —
     *  callers page the RETURNED, already-ranked list, never re-query per
     *  page (pass `FOR_YOU_READ_DEPTH`, the rows the site's deck reads, so
     *  both rank the same roles — this module never invents its own). */
    candidateDepth: number;
    /** Résumé + saved preferences, resolved once by the caller
     *  (`resolveCandidateSignals`). Defaults to the résumé alone. */
    signals?: CandidateSignals;
    /** The clock the roles' ages are read against (30 days is the limit). Defaults to now. */
    nowMs?: number;
}

/**
 * Ranks the corpus against `resume` the same way the site's own fit-sorted
 * For-you view does — see module doc for the exact composition. Never
 * paginates the backend itself.
 */
export async function rankForYou(params: RankForYouParams): Promise<RankForYouResult> {
    const { resume, search, candidateDepth } = params;
    const signals = params.signals ?? resolveCandidateSignals(resume);
    const filters = packFilters(resume, signals);
    const q = filters.q;

    // Roles past Senior (Staff, Principal, Director...) are left out of the pool, not just ranked last, unless
    // the résumé shows such a role: they would otherwise fill the first rows the pool is cut to.
    // The pool also holds the postings that ask for what the résumé shows whatever their title, and remote roles that name no country (listed last).
    const result = await search({ ...packSearchParams(filters, signals, { resume, unplacedRemote: true }), limit: candidateDepth, offset: 0 });

    // A real backend failure (never wired up, or a configured backend that
    // threw) must not read like a true zero-match ranked list — same
    // distinction `isBackendDown` (agent/tools.ts) makes for search_jobs.
    if (result.unavailable === true || !result.configured) {
        return {
            hits: [],
            leftOut: { considered: 0, listed: 0, byReason: {} },
            filters,
            query_used: q,
            unavailable: true,
            note: result.note ?? "search backend unavailable",
        };
    }

    const queryUsed = result.effectiveQ ?? q;
    // `searchJobs` echoes the places it could not filter on (search.ts).
    const unmatched = (result as JobSearchResult & LocationReport).unmatchedPlaceMentions;
    const scored = result.hits.map((job) => {
        const fit = fitFor(resume, job, signals);
        return { job, match: fit?.match ?? null, fit_reasons: fit?.fit_reasons ?? null };
    });
    const nowMs = params.nowMs ?? Date.now();

    const byId = new Map(scored.map((s) => [s.job.id, s] as const));
    const allJobs = scored.map((s) => s.job);
    const scoreOf = (job: PublicJob) => byId.get(job.id)?.match ?? null;
    const { ranked: orderedJobs, summary: counted } = deckListFor(allJobs, scoreOf, nowMs);
    const targets = targetTitlesFromQuery(queryUsed);
    // `found` is what the search said it found when the pool read fewer rows than that (`withListRemovals` keeps it only then),
    // so "left out of the first 150 of 226 roles found" names both numbers and a count is never read as the whole search's.
    const leftOut = withListRemovals(counted, {}, result.total);

    const hits: RankedHit[] = orderedJobs.map((job) => {
        const entry = byId.get(job.id)!;
        const title = decodeText(job.title);
        const group: RankedHit["group"] =
            targets.length > 0 && targets.some((t) => jobTitleMatchesTarget(title, t)) ? "target_title" : "adjacent";
        return { job, match: entry.match, fit_reasons: entry.fit_reasons, group };
    });

    return {
        hits,
        leftOut,
        filters,
        query_used: queryUsed,
        ...(unmatched?.length ? { unmatchedPlaceMentions: unmatched } : {}),
    };
}
