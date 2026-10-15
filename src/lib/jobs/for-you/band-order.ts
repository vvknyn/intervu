/**
 * For-you / postcard pack ordering, the ONE order every list that recommends uses: the deck, the agent's
 * `for_you`, Today, the daily picks (and their email) and the fit-sorted Search list
 * (`forYouSortKey`, `compareForYouKeys`). Roles are ordered by age (a role over a month old after every
 * fresher one), whether the person can take them where they are (`rankTier`'s reach groups), the fit band
 * (Strong ≥80, Good 60–79, Stretch <60, unscored last), then by what the posting asks for that the résumé
 * shows (`contentLead`), the fit total and freshness. The résumé's own title only breaks a tie in that
 * (`OWN_ROLE_LIFT`): content first, title last (Vivek, 2026-10-14).
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts and title-relevance.ts.
 */
import { forYouLeftOut, type ForYouLeftOut } from "@/lib/jobs/for-you/left-out";
import { partitionByTargetTitle } from "@/lib/jobs/for-you/title-relevance";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { matchBand, rankBand, rankingValue, rankTier, type MatchBand, type MatchScore } from "@/lib/match/score";

/** `rankTier` values: Stretch roles start at 300, roles outside reach (place unknown, abroad, unscored) at 500. */
const STRETCH_TIER_FLOOR = 300;
const OUT_OF_REACH_TIER = 500;
import type { PublicJob } from "@/lib/jobs/types";

/** How the résumé's own role and its family rank against each other and the rest when the fit is exactly equal (`forYouSortKey`'s tie-break). */
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
export function deckLeftOut(
    job: PublicJob,
    score: MatchScore | null | undefined,
    nowMs: number,
    /** Today and the daily picks: a pick needs evidence of where it is, so a role that names no country, and a candidate whose country can't be read, are out (his rule: "Country unclear" is out of picks). */
    options: { strictPlace?: boolean } = {},
): DeckLeftOut | null {
    if (packAgeTier(postedTsOf(job), nowMs, job.first_seen_at ?? null) === 2) return "old";
    if (score == null) return "other-role";
    return forYouLeftOut(score, options.strictPlace ? {} : { keepWhenCandidatePlaceUnread: true, keepUnplaced: true });
}

/** When a role was posted: the index's own `posted_ts`, else read from its dates (`derivePostedTs`). */
export const postedTsOf = (job: PublicJob): number | null => (typeof job.posted_ts === "number" ? job.posted_ts : derivePostedTs(job));

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
    // The order is `forYouSortKey`'s. Without a clock (no ranking asked for) the old tier × band × title order holds.
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
    const keyed: { job: PublicJob; sort: ForYouSortKey; index: number }[] = [];
    jobs.forEach((job, index) => {
        const score = getScore(job);
        // A recommendation holds only roles this résumé could take (`deckLeftOut`): not a tail of Stretch roles, not a label.
        if (score == null || !holds(deckLeftOut(job, score, nowMs))) return;
        keyed.push({ job, sort: forYouSortKey(score, postedTsOf(job), nowMs, job.first_seen_at), index });
    });
    keyed.sort((a, b) => compareForYouKeys(a.sort, b.sort) || a.index - b.index);
    return keyed.map((k) => k.job);
}

/** What a role is ordered by (`compareForYouKeys`). */
export interface ForYouSortKey {
    /** Age, then reach, then fit band: lower leads. */
    key: number;
    /** Inside that: the fit total with freshness and the content credit, rounded: higher leads. The title is not in it. */
    value: number;
    /** The résumé's own role (`OWN_ROLE_LIFT`) or family (`FAMILY_ROLE_LIFT`) lift: it only breaks a tie in `value`. */
    lift: number;
    /** The components' own scores, which break a tie the capped total leaves. */
    raw: number;
}

/**
 * The key every recommending list orders by: age, then whether the person can take the role where they are,
 * then the fit band, then the fit itself (the whole résumé against the whole posting, what the posting asks
 * for that the résumé shows (`contentLead`), plus freshness). The role's title is last: the résumé's own title
 * (or its family) lifts a role only among roles whose rounded fit is exactly equal, so it never moves a
 * role past a better-fitting one (Vivek, 2026-10-14: "title matched LAST, only as a tie-breaker, never a
 * filter"). The title family is also inside the fit's caps (`scoreJobAgainstResume`), not a key of its own:
 * "own title first" filled a PM-and-TAM résumé's deck with one family ahead of better fits (2026-10-13).
 */
export function forYouSortKey(score: MatchScore, postedTs: number | null, nowMs: number, firstSeenAt?: string | null): ForYouSortKey {
    const bands = BAND_SEQUENCE.length + 1;
    const age = packAgeTier(postedTs, nowMs, firstSeenAt ?? null);
    const tier = rankTier(score);
    const group = tier >= OUT_OF_REACH_TIER ? 2 : tier >= STRETCH_TIER_FLOOR ? 1 : 0;
    const band = rankBand(score, postedTs, nowMs);
    // A capped total ties roles that fit differently; the components' own scores break the tie.
    const raw = score.components.reduce((sum, c) => sum + c.score, 0);
    const lift = score.role === "own" ? OWN_ROLE_LIFT : score.role === "family" ? FAMILY_ROLE_LIFT : 0;
    return { key: (age * 3 + group) * bands + band, value: Math.round(rankingValue(score, postedTs, nowMs) + contentLead(score)), lift, raw };
}

export const compareForYouKeys = (a: ForYouSortKey, b: ForYouSortKey): number => a.key - b.key || b.value - a.value || b.lift - a.lift || b.raw - a.raw;

/**
 * A fit-sorted list (the Search board's Rank by fit) in the same order as the deck and Today
 * (`forYouSortKey`), nothing left out: roles this device hadn't listed before come first inside a fit band
 * (`seen`), roles with no score last in their incoming order. Stable.
 */
export function sortByFit<T>(
    items: readonly T[],
    pick: (item: T) => { job: PublicJob; score: MatchScore | null | undefined },
    opts: { nowMs: number; seen?: (id: string) => boolean },
): T[] {
    const keyed = items.map((item, index) => {
        const { job, score } = pick(item);
        return { item, index, job, sort: score ? forYouSortKey(score, postedTsOf(job), opts.nowMs, job.first_seen_at) : null };
    });
    const listed = (k: { job: PublicJob }) => Number(opts.seen?.(k.job.id) ?? false);
    keyed.sort((a, b) => {
        if (!a.sort || !b.sort) return a.sort ? -1 : b.sort ? 1 : a.index - b.index;
        return a.sort.key - b.sort.key || listed(a) - listed(b) || compareForYouKeys(a.sort, b.sort) || a.index - b.index;
    });
    return keyed.map((k) => k.item);
}
