/**
 * For-you ranking — pure candidate composition + ordering, browser-safe (no
 * server-only import may ever land here; `search` is injected precisely so
 * this never reaches for an MCP-only or server-only search implementation
 * directly).
 *
 * Mirrors the SAME pipeline `/jobs` (`app/jobs/page.tsx`, read-only
 * reference — never edited here) runs client-side: `buildMatchQuery(resume)`
 * plus résumé-derived location facets (`applyFit`, ~page.tsx:4082) → one
 * search call → fit attached per hit → sorted by `match.total` descending
 * (`matchScores`/`renderedClusters`, ~page.tsx:2782-2828) → reordered by
 * `partitionByTargetTitle` so cards matching the query's own target
 * title(s) lead. A future web caller could adopt this module directly
 * instead of re-deriving the same steps a second time.
 *
 * Scoring/reasons pairing goes through the ONE fit chokepoint (`fitFor`,
 * ./fit.ts) — this module never calls `scoreJobAgainstResume` or
 * `inferReasons` itself.
 */
import { buildMatchQuery, mergeFacets } from "@/lib/jobs/resume-match";
import { deriveResumeLocationFacets } from "@/lib/jobs/resume-location";
import { fitFor } from "@/lib/jobs/for-you/fit";
import { partitionByTargetTitle, targetTitlesFromQuery, jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { decodeText } from "@/lib/jobs/presentation";
import type { JobSearchParams, JobSearchResult, PostedBucket, PublicJob } from "@/lib/jobs/types";
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
    query_used: string;
    /** Mirrors `SearchOut`'s unavailable/note pair (agent/tools.ts) — a real
     *  backend failure, never a true zero-match ranked list. */
    unavailable?: boolean;
    note?: string;
}

export interface RankForYouParams {
    resume: ResumeData;
    search: (params: JobSearchParams) => Promise<JobSearchResult>;
    /** Candidate pool size fetched from `search` before ranking/paging —
     *  callers page the RETURNED, already-ranked list, never re-query per
     *  page (pass `AGENT.SEARCH_DEPTH_CAP`, the existing agent-wide depth
     *  cap — this module never invents its own). */
    candidateDepth: number;
    /** Same "posted within" window the site defaults to
     *  (`DEFAULT_URL_STATE.postedBucket`, url-state.ts) — defaults to
     *  "30d" here too when omitted. */
    postedBucket?: PostedBucket;
}

/**
 * Ranks the corpus against `resume` the same way the site's own fit-sorted
 * For-you view does — see module doc for the exact composition. Never
 * paginates the backend itself.
 */
export async function rankForYou(params: RankForYouParams): Promise<RankForYouResult> {
    const { resume, search, candidateDepth, postedBucket } = params;
    const { q, facets: derivedFacets } = buildMatchQuery(resume);
    const locationFacets = deriveResumeLocationFacets(resume.profile?.location);
    const facets = mergeFacets({}, { ...derivedFacets, ...locationFacets });

    const result = await search({
        q,
        hideGhosts: true,
        postedBucket: postedBucket ?? "30d",
        limit: candidateDepth,
        offset: 0,
        ...(Object.keys(facets).length ? { facets } : {}),
    });

    // A real backend failure (never wired up, or a configured backend that
    // threw) must not read like a true zero-match ranked list — same
    // distinction `isBackendDown` (agent/tools.ts) makes for search_jobs.
    if (result.unavailable === true || !result.configured) {
        return {
            hits: [],
            query_used: q,
            unavailable: true,
            note: result.note ?? "search backend unavailable",
        };
    }

    const queryUsed = result.effectiveQ ?? q;
    const scored = result.hits.map((job) => {
        const fit = fitFor(resume, job);
        return { job, match: fit?.match ?? null, fit_reasons: fit?.fit_reasons ?? null };
    });
    // Stable sort, unscored jobs last (Array.prototype.sort is stable per spec).
    scored.sort((a, b) => (b.match?.total ?? -1) - (a.match?.total ?? -1));

    const orderedJobs = partitionByTargetTitle(scored.map((s) => s.job), queryUsed);
    const byId = new Map(scored.map((s) => [s.job.id, s] as const));
    const targets = targetTitlesFromQuery(queryUsed);

    const hits: RankedHit[] = orderedJobs.map((job) => {
        const entry = byId.get(job.id)!;
        const title = decodeText(job.title);
        const group: RankedHit["group"] =
            targets.length > 0 && targets.some((t) => jobTitleMatchesTarget(title, t)) ? "target_title" : "adjacent";
        return { job, match: entry.match, fit_reasons: entry.fit_reasons, group };
    });

    return { hits, query_used: queryUsed };
}
