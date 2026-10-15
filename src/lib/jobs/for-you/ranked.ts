/**
 * For-you ranking — pure candidate composition + ordering, browser-safe (no
 * server-only import may ever land here; `search` is injected precisely so
 * this never reaches for an MCP-only or server-only search implementation
 * directly).
 *
 * A pack IS a `/jobs` filter state (`packFilters`, ./pack-filters.ts): the
 * search call is exactly the one `/jobs` sends for those filters, so the ids
 * a candidate gets by applying them by hand are the ids returned here. Fit
 * only REORDERS that result (the candidate's own role first, then by
 * `match.total` descending, then `orderForYouJobsByBand`: role tier, then
 * Strong → Good, with target-title relevance inside each band). A recommendation list is not a
 * search: a role the résumé could not take (`deckLeftOut`: above their level, asks for what the
 * résumé doesn't show, a different kind of role, outside where they can work, too old) is left out,
 * and `leftOut` counts each reason, so every row of the search is either listed or accounted for.
 *
 * Scoring/reasons pairing goes through the ONE fit chokepoint (`fitFor`,
 * ./fit.ts) — this module never calls `scoreJobAgainstResume` or
 * `inferReasons` itself.
 */
import { resolveCandidateSignals, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { packFilters, packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import { orderForYouJobsByBand, summarizeDeckLeftOut, type DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import { fitFor } from "@/lib/jobs/for-you/fit";
import { targetTitlesFromQuery, jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { decodeText } from "@/lib/jobs/presentation";
import type { JobSearchParams, JobSearchResult, PublicJob } from "@/lib/jobs/types";
import type { LocationReport } from "@/lib/jobs/broaden";
import type { JobsUrlState } from "@/lib/jobs/url-state";
import { compareFit, levelUnverified, rankTier, type MatchScore } from "@/lib/match/score";
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
    /** What the search returned and the list left out, by reason (the rows of `hits` are the rest). */
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
     *  page (pass `AGENT.SEARCH_DEPTH_CAP`, the existing agent-wide depth
     *  cap — this module never invents its own). */
    candidateDepth: number;
    /** Résumé + saved preferences, resolved once by the caller
     *  (`resolveCandidateSignals`). Defaults to the résumé alone. */
    signals?: CandidateSignals;
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
    // Stable sort: the candidate's own role first (`roleTier`), then jobs whose level is verified
    // (a seniority filter also retrieves the never-derived-level rows, which rank lower), then by
    // total, unscored jobs last
    // (Array.prototype.sort is stable per spec). Band order below keeps this order inside a band.
    const unverified = (job: PublicJob) => (levelUnverified(signals, job) ? 1 : 0);
    const nowMs = Date.now();
    scored.sort(
        (a, b) =>
            rankTier(a.match) - rankTier(b.match) ||
            unverified(a.job) - unverified(b.job) ||
            compareFit(a.match, b.match, a.job.posted_ts, b.job.posted_ts, nowMs),
    );

    const byId = new Map(scored.map((s) => [s.job.id, s] as const));
    const orderedJobs = orderForYouJobsByBand(
        scored.map((s) => s.job),
        (job) => byId.get(job.id)?.match ?? null,
        queryUsed,
        nowMs,
    );
    const targets = targetTitlesFromQuery(queryUsed);
    const leftOut = summarizeDeckLeftOut(
        scored.map((s) => s.job),
        (job) => byId.get(job.id)?.match ?? null,
        nowMs,
    );

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
