/**
 * For-you deck order — target-title relevance.
 *
 * When the search that produced the deck named target titles (typed or
 * résumé-derived, single title or an "A OR B" list — `result.effectiveQ`,
 * the query the SERVER actually ran, same field `partitionByTitleMatch`
 * already reads for the SERP's own title seam), cards whose title matches
 * at least one target title belong ahead of every card that matches none.
 * Deliberately reads `effectiveQ`, never a second fetch/re-derivation of the
 * caller's preferences: a re-derived request drifts from the lane that
 * actually ran (facet-overlay incident, 2026-09).
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts.
 */
import { decodeText, meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { RANK_WORDS } from "@/lib/match/duty-signals";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * Split a query into the target titles it names — quoted ("A" OR "B", the
 * fit-phrase lane's own format, fit-phrases.ts) or plain (A OR B, what a
 * typed or agent-set query looks like before any lane rewrites it), one
 * title, or none. Deliberately more permissive than fit-phrases.ts's
 * `parseQuotedOrPhrases`: that function gates a different, stricter
 * retrieval lane and rejects unquoted input on purpose; this only reads
 * display-order titles out of whatever query actually ran, so a plain
 * typed "A OR B" still names two targets.
 */
export function targetTitlesFromQuery(q: string | null | undefined): string[] {
    const trimmed = (q ?? "").trim();
    if (!trimmed) return [];
    return trimmed
        .split(/\s+OR\s+/i)
        .map((part) => part.trim().replace(/^"|"$/g, "").trim())
        .filter(Boolean);
}

/**
 * A title's significant tokens for target-title matching: `meaningfulTitleTokens`
 * (presentation.ts — lowercases, strips punctuation, strips function words)
 * with rank/seniority words (`RANK_WORDS`, duty-signals.ts) also dropped.
 * Rank words are a separate match dimension (`scoreSeniority`, match/score.ts
 * already compares résumé years against the job's level) — a "Sr." target
 * must still find a "Senior" job title and vice versa, so neither side's
 * rank word is ever required.
 */
function titleMatchTokens(title: string): string[] {
    return meaningfulTitleTokens(title).filter((t) => !RANK_WORDS.has(t));
}

/**
 * True iff every significant token of `targetTitle` appears, order-
 * insensitive, as some significant token of `jobTitle` — same startsWith
 * tolerance `titleMatchesQuery` (presentation.ts) uses for the SERP's own
 * title match, so e.g. "manager" tolerates "managers". That tolerance is by
 * prefix, not a stemmer: "engineer" also prefix-matches "engineering" (a
 * known, accepted breadth of the existing rule, not new here) — so
 * "Software Engineer" matches a "Software Engineering Manager" job title
 * under this function. An empty target (nothing significant left after
 * stripping function/rank words) never matches — there's nothing left to
 * require.
 */
export function jobTitleMatchesTarget(jobTitle: string, targetTitle: string): boolean {
    const targetTokens = titleMatchTokens(targetTitle);
    if (targetTokens.length === 0) return false;
    const jobTokens = titleMatchTokens(jobTitle);
    return targetTokens.every((qt) => jobTokens.some((jt) => jt.startsWith(qt)));
}

/**
 * The For-you deck's title-relevance partition: a stable reorder of `jobs`
 * into "matches ≥1 target title" first, then everything else, each half
 * keeping its incoming (fit-sorted) relative order — same stable-partition
 * shape as `partitionByTitleMatch` (presentation.ts) uses for the SERP
 * title seam. Non-matching cards are never dropped, only moved down.
 *
 * `query` is the request that actually produced `jobs` (pass
 * `result.effectiveQ`, never a preferences re-fetch — see module doc). No
 * target titles in it (empty/no-OR query, or nothing after parsing) leaves
 * `jobs` in its original order.
 */
export function partitionByTargetTitle(jobs: readonly PublicJob[], query: string | null | undefined): PublicJob[] {
    const targets = targetTitlesFromQuery(query);
    if (targets.length === 0) return [...jobs];

    const matched: PublicJob[] = [];
    const rest: PublicJob[] = [];
    for (const job of jobs) {
        const title = decodeText(job.title);
        (targets.some((t) => jobTitleMatchesTarget(title, t)) ? matched : rest).push(job);
    }
    return [...matched, ...rest];
}
