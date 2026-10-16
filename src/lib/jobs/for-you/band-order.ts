/**
 * For-you / postcard pack ordering, the ONE order every list that recommends uses: the deck, the agent's
 * `for_you`, Today, the daily picks (and their email) and the fit-sorted Search list
 * (`forYouSortKey`, `compareForYouKeys`). A role posted over a month ago is left out (`deckLeftOut`: "old"); the
 * rest are ordered by age, whether the person can take them where they are (`rankTier`'s reach groups), the fit band
 * (Strong ≥80, Good 60–79, Stretch <60, unscored last), then by what the posting asks for that the résumé
 * shows (`contentLead`), the fit total and freshness. Only a tie in that is broken by the title: first by the kind
 * of work the résumé leads with (`family`), then by its own role (`OWN_ROLE_LIFT`): content first, title last (Vivek, 2026-10-14).
 *
 * Pure, no I/O — same isomorphic convention as match/score.ts and title-relevance.ts.
 */
import { forYouLeftOut, type ForYouLeftOut } from "@/lib/jobs/for-you/left-out";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { sanitizeTimestamp } from "@/lib/jobs/posting-freshness";
import { matchBand, rankBand, rankingValue, rankTier, type MatchBand, type MatchScore } from "@/lib/match/score";
import type { TuneRank } from "@/lib/jobs/for-you/tuning";

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

const PACK_DAY_MS = 86_400_000;
/**
 * Past this age a pack leaves the role out (Vivek, 2026-10-13: "really old jobs in my For you pack"; 2026-10-16: "still
 * showing really old jobs from more than 30 days ago"). It was a demotion at 30 days and a cut at 60, so every role
 * between a month and two months old was listed, last, with nothing on the card that said it was old.
 */
export const PACK_MAX_AGE_DAYS = 30;

/**
 * 0 = fresh (the role's oldest known date, posted or first seen, is within 30 days), 1 = no date at all, 2 = older.
 * A role is as old as the OLDER of its two dates, the same rule "New" and the green freshness line follow
 * (`classifyPostingFreshness`): an employer's date that was moved forward on an old requisition does not make it new
 * ("First seen by us 138d ago, posted date refreshed", 2026-10-13; the same posting first seen 31 to 60 days ago was
 * still listed first).
 */
export function packAgeTier(postedTs: number | null | undefined, nowMs: number, firstSeenAt?: string | null): 0 | 1 | 2 {
    const firstSeen = sanitizeTimestamp(firstSeenAt, nowMs);
    const posted = typeof postedTs === "number" && Number.isFinite(postedTs) ? postedTs : null;
    const oldest = posted != null && firstSeen != null ? Math.min(posted, firstSeen) : (posted ?? firstSeen);
    if (oldest == null) return 1;
    return (nowMs - oldest) / PACK_DAY_MS <= PACK_MAX_AGE_DAYS ? 0 : 2;
}

/** Why a pack's deck leaves a role out: `forYouLeftOut`'s reasons, or "old" for a posting older than a pack lists (`PACK_MAX_AGE_DAYS`). */
export type DeckLeftOut = ForYouLeftOut | "old";

/**
 * Why the deck does not list this role, or `null` when it does: older than a pack keeps (30 days by its oldest
 * date), no score (nothing ties it to the résumé), or any reason `forYouLeftOut` gives. The ONE place the deck's
 * keep-or-drop is decided, so `orderForYouJobsByBand` and `summarizeDeckLeftOut` cannot disagree.
 * Age is checked first and is never lifted by a good fit: the only way an older role is listed is
 * `orderOlderFits`, when nothing newer fits (it asks with `ignoreAge` whether age alone leaves the role out).
 */
export function deckLeftOut(
    job: PublicJob,
    score: MatchScore | null | undefined,
    nowMs: number,
    /** Today and the daily picks: a pick needs evidence of where it is, so a role that names no country, and a candidate whose country can't be read, are out (his rule: "Country unclear" is out of picks). */
    options: { strictPlace?: boolean; ignoreAge?: boolean } = {},
): DeckLeftOut | null {
    if (!options.ignoreAge && packAgeTier(postedTsOf(job), nowMs, job.first_seen_at ?? null) === 2) return "old";
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
    /** No role from the last 30 days fits, so `listed` are roles that fit and were posted longer ago (`orderOlderFits`). */
    older?: true;
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
    nowMs: number,
): PublicJob[] {
    return orderForYouJobsByBand(jobs, getScore, nowMs, (reason) => reason === "stretch");
}

/** `summary` for a list that shows the closest roles because nothing fit: they are `listed`, no longer left out. */
export function nearMissSummary(summary: DeckLeftOutSummary): DeckLeftOutSummary {
    const { stretch = 0, ...rest } = summary.byReason;
    return { considered: summary.considered, listed: stretch, byReason: rest, near: true };
}

/**
 * What a list holds when no role posted in the last 30 days fits: the roles that fit but were posted longer ago,
 * best first, so a rule about age never empties a list. They are marked as older (`DeckLeftOutSummary.older`, the
 * card's age), and come before the closest weaker fits: a role that fits beats one that does not, and the age of
 * each is on its card. Only a role that age alone leaves out (`deckLeftOut` with `ignoreAge`) is here; a role older
 * than that and above the person's level, or abroad, is still out.
 */
export function orderOlderFits(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    nowMs: number,
): PublicJob[] {
    if (!getScore) return [];
    return orderRoles(jobs, getScore, nowMs, (job, score) => packAgeTier(postedTsOf(job), nowMs, job.first_seen_at ?? null) === 2 && deckLeftOut(job, score, nowMs, { ignoreAge: true }) == null);
}

/** `summary` for a list that shows older roles because no newer one fits: `listed` are no longer left out. */
export function olderFitsSummary(summary: DeckLeftOutSummary, listed: number): DeckLeftOutSummary {
    const { old = 0, ...rest } = summary.byReason;
    return { considered: summary.considered, listed, byReason: old > listed ? { ...rest, old: old - listed } : rest, older: true };
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

/**
 * The roles a résumé-backed list holds, in `forYouSortKey`'s order. When `getScore` is absent (no résumé /
 * caller opts out), a shallow copy in incoming order: anonymous Search browsing is unchanged. There is no
 * second order: the title is not a key here (`partitionByTargetTitle`, which put the résumé's own title
 * first, is gone so it cannot come back by accident).
 */
export function orderForYouJobsByBand(
    jobs: readonly PublicJob[],
    getScore: ((job: PublicJob) => MatchScore | null | undefined) | null | undefined,
    /** Places a role over two weeks old one band lower (`rankBand`), as every ranked list does. */
    nowMs: number,
    /** Which roles the list holds, by why `deckLeftOut` leaves them out (`null` = it does not). Default: the ones it does not. */
    holds: (reason: DeckLeftOut | null) => boolean = (reason) => reason == null,
): PublicJob[] {
    if (!getScore) return [...jobs];
    return orderRoles(jobs, getScore, nowMs, (job, score) => holds(deckLeftOut(job, score, nowMs)));
}

/** The scored roles `keep` holds, in `forYouSortKey`'s order (ties keep the incoming order). A recommendation holds only roles this résumé could take: not a tail of Stretch roles, not a label. */
function orderRoles(
    jobs: readonly PublicJob[],
    getScore: (job: PublicJob) => MatchScore | null | undefined,
    nowMs: number,
    keep: (job: PublicJob, score: MatchScore) => boolean,
): PublicJob[] {
    const keyed: { job: PublicJob; sort: ForYouSortKey; index: number }[] = [];
    jobs.forEach((job, index) => {
        const score = getScore(job);
        if (score == null || !keep(job, score)) return;
        keyed.push({ job, sort: forYouSortKey(score, postedTsOf(job), nowMs, job.first_seen_at), index });
    });
    keyed.sort((a, b) => compareForYouKeys(a.sort, b.sort) || a.index - b.index);
    return keyed.map((k) => k.job);
}

/**
 * Where a scored role sits before the visitor's nudges (`tuneDeck`): the group the one order puts it in (age, reach and fit
 * band: `forYouSortKey(...).key`), and whether the résumé holds its title (its own role or the same kind of work).
 */
export function tuneRank(score: MatchScore, job: PublicJob, nowMs: number): TuneRank {
    return {
        band: forYouSortKey(score, postedTsOf(job), nowMs, job.first_seen_at).key,
        held: score.role === "own" || score.role === "family",
    };
}

/** What a role is ordered by (`compareForYouKeys`). */
export interface ForYouSortKey {
    /** Age, then reach, then fit band: lower leads. */
    key: number;
    /** Inside that: the fit total with freshness and the content credit, rounded: higher leads. The title is not in it. */
    value: number;
    /**
     * Which kind of work the résumé leads with this role belongs to (`MatchScore.familyRank`): 0 is the kind its
     * headline, summary and skill groups lead with, ahead of the kind its current job names. Lower leads, and only
     * among roles whose `value` is exactly equal.
     */
    family: number;
    /** The résumé's own role (`OWN_ROLE_LIFT`) or family (`FAMILY_ROLE_LIFT`) lift: it only breaks a tie in `value` and `family`. */
    lift: number;
    /** The components' own scores, which break a tie the capped total leaves. */
    raw: number;
}

/**
 * The key every recommending list orders by: age, then whether the person can take the role where they are,
 * then the fit band, then the fit itself (the whole résumé against the whole posting, what the posting asks
 * for that the résumé shows (`contentLead`), plus freshness). The role's title is last: among roles whose
 * rounded fit is exactly equal, the kind of work the résumé leads with comes first (`family`: its headline,
 * summary and skill groups before its current job's title), then its own title (or its family) lifts, so
 * none of them moves a role past a better-fitting one (Vivek, 2026-10-14: "title matched LAST, only as a
 * tie-breaker, never a filter"). A posting with no text to read (a bare list row) has only its title to
 * match, so many such rows tie on fit; without `family` they listed in the order the search returned them
 * (J-JOBS-93: a customer success résumé opened on Product Manager roles, its current job's title). The title family is also
 * inside the fit's caps (`scoreJobAgainstResume`), not a key of its own: "own title first" filled a
 * PM-and-TAM résumé's deck with one family ahead of better fits (2026-10-13).
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
    return { key: (age * 3 + group) * bands + band, value: Math.round(rankingValue(score, postedTs, nowMs) + contentLead(score)), family: score.familyRank ?? 0, lift, raw };
}

export const compareForYouKeys = (a: ForYouSortKey, b: ForYouSortKey): number =>
    a.key - b.key || b.value - a.value || a.family - b.family || b.lift - a.lift || b.raw - a.raw;

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
