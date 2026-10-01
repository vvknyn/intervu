/**
 * For-you / postcard pack ordering — the candidate's own role first, then the
 * same kind of role, then neighbours (`roleTier`, match/score.ts); inside each,
 * Strong (≥80) first, then Good (60–79), then Stretch (<60), then unscored.
 * Within each band, target-title relevance (`partitionByTargetTitle`) runs
 * before adjacent cards; relative order inside each (tier × band × title)
 * slice is preserved (stable bucket pass).
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts and
 * title-relevance.ts.
 */
import { partitionByTargetTitle } from "@/lib/jobs/for-you/title-relevance";
import { matchBand, roleTier, type MatchBand, type MatchScore } from "@/lib/match/score";
import type { PublicJob } from "@/lib/jobs/types";

const BAND_SEQUENCE: readonly MatchBand[] = ["strong", "good", "stretch"];

/** Sort key for band-first ordering; unscored sorts after every band. */
export function matchBandSortKey(score: MatchScore | null | undefined): number {
    if (score == null) return BAND_SEQUENCE.length;
    return BAND_SEQUENCE.indexOf(matchBand(score.total));
}

/**
 * Reorders `jobs` for résumé-backed For-you packs. When `getScore` is absent
 * (no résumé / caller opts out), returns a shallow copy in incoming order —
 * anonymous Search browsing is unchanged.
 */
export function orderForYouJobsByBand(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    query?: string | null,
): PublicJob[] {
    if (!getScore) return [...jobs];

    const bands = BAND_SEQUENCE.length + 1;
    const buckets = new Map<number, PublicJob[]>();
    for (const job of jobs) {
        const score = getScore(job);
        const key = roleTier(score) * bands + matchBandSortKey(score);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(job);
        else buckets.set(key, [job]);
    }

    const out: PublicJob[] = [];
    for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
        out.push(...partitionByTargetTitle(buckets.get(key)!, query));
    }
    return out;
}
