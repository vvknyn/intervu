/**
 * For-you / postcard pack ordering — the candidate's own role first, then the
 * same kind of role, then neighbours, with every Stretch role after all the
 * roles they can take (`rankTier`, match/score.ts); inside each,
 * Strong (≥80) first, then Good (60–79), then Stretch (<60), then unscored.
 * Within each band, target-title relevance (`partitionByTargetTitle`) runs
 * before adjacent cards; relative order inside each (tier × band × title)
 * slice is preserved (stable bucket pass).
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts and
 * title-relevance.ts.
 */
import { partitionByTargetTitle } from "@/lib/jobs/for-you/title-relevance";
import { matchBand, rankBand, rankTier, type MatchBand, type MatchScore } from "@/lib/match/score";
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
const PACK_DAY_MS = 86_400_000;
/** Past this age a pack demotes a role below every fresher one (Vivek, 2026-10-13: "really old jobs in my For you pack"). */
export const PACK_STALE_DAYS = 30;
/** Past this age a pack leaves the role out entirely: by two months most such roles are filled or ghosted. */
export const PACK_MAX_AGE_DAYS = 60;

/** 0 = fresh (≤30d), 1 = stale (30–60d) or undated, 2 = too old for a pack (>60d). */
export function packAgeTier(postedTs: number | null | undefined, nowMs: number): 0 | 1 | 2 {
    if (typeof postedTs !== "number" || !Number.isFinite(postedTs)) return 1;
    const days = (nowMs - postedTs) / PACK_DAY_MS;
    return days <= PACK_STALE_DAYS ? 0 : days <= PACK_MAX_AGE_DAYS ? 1 : 2;
}

export function orderForYouJobsByBand(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    query?: string | null,
    /** Pass to place a role over two weeks old one band lower (`rankBand`), as every ranked list does. */
    nowMs?: number,
): PublicJob[] {
    if (!getScore) return [...jobs];

    const bands = BAND_SEQUENCE.length + 1;
    const buckets = new Map<number, PublicJob[]>();
    // Age outranks role tier: an own-title role posted 85 days ago led the TAM pack above
    // this week's Customer Success roles (measured live, 2026-10-13). Over 60 days is left out.
    const tierSpan = 10_000 * bands;
    for (const job of jobs) {
        const score = getScore(job);
        const age = nowMs !== undefined ? packAgeTier(job.posted_ts ?? null, nowMs) : 0;
        if (age === 2) continue;
        const band = score != null && nowMs !== undefined ? rankBand(score, job.posted_ts ?? null, nowMs) : matchBandSortKey(score);
        const key = age * tierSpan + rankTier(score) * bands + band;
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
