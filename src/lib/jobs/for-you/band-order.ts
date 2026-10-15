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
import { forYouLeftOut, type ForYouLeftOut } from "@/lib/jobs/for-you/left-out";
import { partitionByTargetTitle } from "@/lib/jobs/for-you/title-relevance";
import { matchBand, rankBand, rankingValue, rankTier, type MatchBand, type MatchScore } from "@/lib/match/score";

/** `rankTier` values: Stretch roles start at 300, roles outside reach (place unknown, abroad, unscored) at 500. */
const STRETCH_TIER_FLOOR = 300;
const OUT_OF_REACH_TIER = 500;
import type { PublicJob } from "@/lib/jobs/types";

/** The ranking lift inside a band for the résumé's own role and for its family (`orderForYouJobsByBand`). */
export const OWN_ROLE_LIFT = 6;
export const FAMILY_ROLE_LIFT = 3;

/**
 * The ranking credit inside a band for how much of the posting the résumé shows beyond the posting's own
 * title words (`MatchComponent.jd.evidence`): up to `CONTENT_LEAD_POINTS` at `CONTENT_LEAD_FULL_EVIDENCE`
 * terms. The fit total saturates (a posting that shares a quarter of its words with the résumé reads 100,
 * and a title echoed in a two-line body counts), so a generic posting tied a detailed one and the order
 * between them was whatever the search returned first. Same size as a week-old posting's freshness credit.
 */
export const CONTENT_LEAD_POINTS = 12;
export const CONTENT_LEAD_FULL_EVIDENCE = 16;

export function contentLead(score: MatchScore): number {
    const evidence = score.components.find((c) => c.key === "relevance")?.jd?.evidence;
    return typeof evidence === "number" ? CONTENT_LEAD_POINTS * Math.min(1, evidence / CONTENT_LEAD_FULL_EVIDENCE) : 0;
}

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
export function packAgeTier(postedTs: number | null | undefined, nowMs: number, firstSeenAt?: string | null): 0 | 1 | 2 {
    // A re-stamped posting first seen over 60 days ago is old, whatever date it now claims
    // ("First seen by us 138d ago, posted date refreshed", 2026-10-13).
    const firstSeen = firstSeenAt ? Date.parse(firstSeenAt) : NaN;
    if (Number.isFinite(firstSeen) && (nowMs - firstSeen) / PACK_DAY_MS > PACK_MAX_AGE_DAYS) return 2;
    if (typeof postedTs !== "number" || !Number.isFinite(postedTs)) return 1;
    const days = (nowMs - postedTs) / PACK_DAY_MS;
    return days <= PACK_STALE_DAYS ? 0 : days <= PACK_MAX_AGE_DAYS ? 1 : 2;
}

/** Why a pack's deck leaves a role out: `forYouLeftOut`'s reasons, or "old" for a posting too old for a pack. */
export type DeckLeftOut = ForYouLeftOut | "old";

/**
 * Why the deck does not list this role, or `null` when it does: older than a pack keeps, no score
 * (nothing ties it to the résumé), or any reason `forYouLeftOut` gives. The ONE place the deck's
 * keep-or-drop is decided, so `orderForYouJobsByBand` and `summarizeDeckLeftOut` cannot disagree.
 */
export function deckLeftOut(job: PublicJob, score: MatchScore | null | undefined, nowMs: number): DeckLeftOut | null {
    if (packAgeTier(job.posted_ts ?? null, nowMs, job.first_seen_at ?? null) === 2) return "old";
    if (score == null) return "other-role";
    return forYouLeftOut(score, { keepWhenCandidatePlaceUnread: true, keepUnplaced: true });
}

export interface DeckLeftOutSummary {
    /** Roles the search returned and the deck weighed. */
    considered: number;
    /** Roles the deck lists. */
    listed: number;
    /** Roles left out, by the first reason that applies. */
    byReason: Partial<Record<DeckLeftOut, number>>;
    /** Nothing fit, so `listed` are the closest roles, each a weaker fit (`orderNearMisses`), not roles that fit. */
    near?: true;
}

/**
 * What a list holds when no role fits: the roles it left out only as a weaker fit (Stretch, a coverage gap
 * included), best first, so a list is never empty while roles were found. A role it left out for a reason about
 * the person or the place (above their level, a language, a clearance, another country, another kind of job,
 * too old) is still out.
 */
export function orderNearMisses(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    query: string | null | undefined,
    nowMs: number,
): PublicJob[] {
    return orderForYouJobsByBand(jobs, getScore, query, nowMs, (reason) => reason === "stretch");
}

/** `summary` for a list that shows the closest roles because nothing fit: they are `listed`, no longer left out. */
export function nearMissSummary(summary: DeckLeftOutSummary): DeckLeftOutSummary {
    const { stretch = 0, ...rest } = summary.byReason;
    return { considered: summary.considered, listed: stretch, byReason: rest, near: true };
}

/** What the deck listed of `jobs` and why it left the rest out. */
export function summarizeDeckLeftOut(
    jobs: readonly PublicJob[],
    getScore: (job: PublicJob) => MatchScore | null | undefined,
    nowMs: number,
): DeckLeftOutSummary {
    const byReason: DeckLeftOutSummary["byReason"] = {};
    let listed = 0;
    for (const job of jobs) {
        const reason = deckLeftOut(job, getScore(job), nowMs);
        if (reason == null) listed++;
        else byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    return { considered: jobs.length, listed, byReason };
}

export function orderForYouJobsByBand(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    query?: string | null,
    /** Pass to place a role over two weeks old one band lower (`rankBand`), as every ranked list does. */
    nowMs?: number,
    /** Which roles the list holds, by why `deckLeftOut` leaves them out (`null` = it does not). Default: the ones it does not. */
    holds: (reason: DeckLeftOut | null) => boolean = (reason) => reason == null,
): PublicJob[] {
    if (!getScore) return [...jobs];

    const bands = BAND_SEQUENCE.length + 1;
    const buckets = new Map<number, PublicJob[]>();
    // Age, then whether the role is one they can take where they are, then the fit band, then the
    // fit itself (the whole résumé against the whole posting, plus freshness). The role's title
    // family is inside the fit (relevance, its off-target cap), not a key of its own: "own title
    // first" filled a PM-and-TAM résumé's deck with one family ahead of better fits (2026-10-13).
    // Without a clock (no ranking asked for) the old tier × band × title order holds.
    if (nowMs === undefined) {
        const legacy = new Map<number, PublicJob[]>();
        for (const job of jobs) {
            const score = getScore(job);
            const key = rankTier(score) * bands + matchBandSortKey(score);
            const bucket = legacy.get(key);
            if (bucket) bucket.push(job);
            else legacy.set(key, [job]);
        }
        const out: PublicJob[] = [];
        for (const key of [...legacy.keys()].sort((a, b) => a - b)) out.push(...partitionByTargetTitle(legacy.get(key)!, query));
        return out;
    }
    const keyed: { job: PublicJob; key: number; value: number; raw: number; index: number }[] = [];
    jobs.forEach((job, index) => {
        const score = getScore(job);
        // A recommendation holds only roles this résumé could take (`deckLeftOut`): not a tail of Stretch roles, not a label.
        if (score == null || !holds(deckLeftOut(job, score, nowMs))) return;
        const age = packAgeTier(job.posted_ts ?? null, nowMs, job.first_seen_at ?? null);
        const tier = rankTier(score);
        const group = tier >= OUT_OF_REACH_TIER ? 2 : tier >= STRETCH_TIER_FLOOR ? 1 : 0;
        const band = rankBand(score, job.posted_ts ?? null, nowMs);
        // A capped total ties roles that fit differently; the components' own scores break the tie.
        const raw = score.components.reduce((sum, c) => sum + c.score, 0);
        // Inside a band the résumé's primary line of work still leads (2026-10-13, senior-aware fit: a
        // TAM résumé read senior must not see Senior PM roles ahead of its TAM ones): a small lift for
        // its own role and its family, not a key of its own, so a much better fit elsewhere still wins.
        // The content credit (`contentLead`) is what the posting itself asks that the résumé covers: it
        // leads, the title lift only breaks what it leaves tied (Vivek, 2026-10-14: content first, title last).
        const lift = score.role === "own" ? OWN_ROLE_LIFT : score.role === "family" ? FAMILY_ROLE_LIFT : 0;
        keyed.push({ job, key: (age * 3 + group) * bands + band, value: rankingValue(score, job.posted_ts ?? null, nowMs) + lift + contentLead(score), raw, index });
    });
    keyed.sort((a, b) => a.key - b.key || b.value - a.value || b.raw - a.raw || a.index - b.index);
    const out = keyed.map((k) => k.job);
    return out;
}
