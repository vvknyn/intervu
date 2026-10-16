/**
 * Today on the packs home, under the pack chips: the week's roles worth a
 * look for this résumé, and what is the visitor's to do now. Pure helpers
 * only; the component (`components/jobs/for-you/TodayHome.tsx`) owns the
 * search and storage.
 *
 * "New since your last visit" is per device, like every other visit cursor
 * in the product (`visit-cursor.ts`). A reload inside one sitting keeps the
 * same baseline, so what reads as new doesn't change the moment it is read.
 */
import { decodeText, locationText } from "@/lib/jobs/presentation";
import { trackedPursuitFor, type TrackedIndex, type TrackedLike } from "@/lib/pursuits/applied";
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import { needsPlaceCheck } from "@/lib/jobs/place-restriction";
import { compareForYouKeys, deckLeftOut, forYouSortKey, postedTsOf, tuneRank } from "@/lib/jobs/for-you/band-order";
import type { PlaceRestriction, PublicJob } from "@/lib/jobs/types";
import { tuneDeck, type TuningNudge } from "@/lib/jobs/for-you/tuning";
import { forYouLeftOut, type ForYouLeftOut } from "@/lib/jobs/for-you/left-out";
import type { MatchComponent, MatchScore } from "@/lib/match/score";
import { startOfLocalDay } from "@/lib/pursuits/daily-apply-plan";
import { isStalePursuit } from "@/lib/pursuits/tracker-display";
import type { Pursuit } from "@/lib/pursuits/types";

const DAY_MS = 86_400_000;

/** An application with no status change for this long is due a follow-up. */
export const TODAY_FOLLOW_UP_DAYS = 7;

/** "Interviews this week": today and the next six calendar days. */
export const TODAY_INTERVIEW_WINDOW_DAYS = 7;

/** Rows Today lists before "More in Added this week". */
export const TODAY_PICK_ROWS = 5;

/** Today picks from roles posted this far back: the week, whatever the last visit. */
export const TODAY_PICKS_WINDOW_MS = 7 * DAY_MS;

/** Roles the picks search reads (the pack's own relevance order) before scoring. */
export const TODAY_PICKS_FETCH_LIMIT = 60;

/** A first visit (no stored visit) looks back this far. */
export const TODAY_FIRST_VISIT_LOOKBACK_MS = 7 * DAY_MS;

/** Two loads closer than this are one sitting: the baseline doesn't move. */
export const TODAY_SESSION_GAP_MS = 30 * 60_000;

/** Stages that are over: nothing left to follow up or prepare for. */
const CLOSED_STAGES = new Set<Pursuit["status"]>(["offer", "rejected", "withdrawn"]);

function parseMs(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
}

/**
 * Applied, then no update for `TODAY_FOLLOW_UP_DAYS`: the tracker's own
 * stale rule (`isStalePursuit`, same clock and stage) at the follow-up
 * threshold, longest waiting first.
 */
export function followUpsDue(pursuits: Pursuit[], nowMs: number): Pursuit[] {
    return pursuits
        .filter((p) => isStalePursuit(p, nowMs, TODAY_FOLLOW_UP_DAYS))
        .sort((a, b) => (parseMs(a.updated_at) ?? 0) - (parseMs(b.updated_at) ?? 0));
}

/**
 * The local midnight of an interview's calendar day. The tracker stores a
 * picked date as that date's UTC midnight (`new Date("2026-10-01")`), which
 * in a zone west of UTC is the evening before: read that shape as the date
 * it names. A stored time of day is kept as is.
 */
export function interviewDayMs(iso: string | null | undefined): number | null {
    const ms = parseMs(iso);
    if (ms == null) return null;
    const at = new Date(ms);
    if (at.getUTCHours() === 0 && at.getUTCMinutes() === 0 && at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0) {
        return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()).getTime();
    }
    return startOfLocalDay(ms);
}

/** Interviews today through the next six days, soonest first. */
export function interviewsThisWeek(pursuits: Pursuit[], nowMs: number): Pursuit[] {
    const from = startOfLocalDay(nowMs);
    const to = from + TODAY_INTERVIEW_WINDOW_DAYS * DAY_MS;
    return pursuits
        .filter((p) => {
            if (CLOSED_STAGES.has(p.status)) return false;
            const day = interviewDayMs(p.interview_date);
            return day != null && day >= from && day < to;
        })
        .sort((a, b) => (parseMs(a.interview_date) ?? 0) - (parseMs(b.interview_date) ?? 0));
}

export type TodayRole = { job: PublicJob; score: MatchScore };

/**
 * Why a scored role is not one of today's picks: the rule every recommendation list shares (`forYouLeftOut`,
 * left-out.ts). Today is the short list, so it also keeps only the week's new roles (`pickToday`).
 */
export type TodayLeftOut = ForYouLeftOut;

export const todayLeftOut = forYouLeftOut;

/** The same opening listed twice (re-synced or cross-posted): its title, company and place. A role open in two cities is two openings. */
export function sameRoleKey(job: PublicJob): string {
    const norm = (s: string | null | undefined) => decodeText(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    return `${norm(job.company)}\0${norm(job.title)}\0${norm(locationText(job))}`;
}

/**
 * Today's picks, best first: the roles `todayLeftOut` keeps that weren't
 * skipped here and aren't in the tracker, in the one order every recommending
 * list uses (`forYouSortKey`: age, reach, fit band, then what the posting asks
 * for that the résumé shows, the fit and freshness; the résumé's own title only
 * lifts a little). Inside a fit band the roles this device hadn't listed before
 * this sitting come first (`seenBefore`), so a pack opened again leads with what
 * is new. Newest first on a tie, each opening once. The visitor's ratings
 * reorder these afterwards (`tuneDeck`).
 *
 * The left-out rule is the deck's (`deckLeftOut`) with one difference that is
 * the product's: a pick needs evidence of where the role is (`strictPlace`), so
 * a role that names no country stays in the deck, last, and out of the picks.
 */
export function pickToday(
    roles: TodayRole[],
    opts: {
        skipped: ReadonlySet<string>;
        tracked: ReadonlySet<string>;
        seenBefore?: ReadonlySet<string> | null;
        nowMs?: number;
        /** Roles applied to, so the same opening listed again under a new id stays out too (lib/pursuits/applied.ts). */
        applied?: TrackedIndex<TrackedLike>;
    },
): TodayRole[] {
    const seen = new Set<string>();
    const nowMs = opts.nowMs ?? Date.now();
    const listed = (r: TodayRole) => opts.seenBefore?.has(r.job.id) ?? false;
    return roles
        .filter(
            (r) =>
                !opts.skipped.has(r.job.id) &&
                !opts.tracked.has(r.job.id) &&
                !(opts.applied && trackedPursuitFor(r.job, opts.applied)) &&
                // The deck's rule, strict on place; its age rule too: a role first seen over 30 days ago is out, whatever date it now claims.
                deckLeftOut(r.job, r.score, nowMs, { strictPlace: true }) == null,
        )
        .map((role) => ({ role, sort: forYouSortKey(role.score, postedTsOf(role.job), nowMs, role.job.first_seen_at) }))
        .sort(
            (a, b) =>
                a.sort.key - b.sort.key ||
                Number(listed(a.role)) - Number(listed(b.role)) ||
                compareForYouKeys(a.sort, b.sort) ||
                (postedTsOf(b.role.job) ?? 0) - (postedTsOf(a.role.job) ?? 0),
        )
        .map(({ role }) => role)
        .filter((r) => {
            const key = sameRoleKey(r.job);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/** A place verdict a description can still change: unknown (it may name their country, or anyone), or only the pay's currency. */
const descriptionCanSettle = (c: MatchComponent): boolean => c.key === "location" && (c.unknown === true || c.reason === "remote_pay_abroad");

/**
 * Today's likely picks, best first, whose rows a description can still place
 * (`needsPlaceCheck`: no country of their own, or several the title doesn't
 * narrow): only the description can say where the person must be, so these
 * are the ones to read (`/api/jobs/place-notes`). A role left out only
 * because its place is unknown (its row names none, or the candidate's own
 * country can't be read), or only for its pay's currency, counts as a likely
 * pick here, since its description may place it in their country or open it
 * to people anywhere. At most `max`.
 */
export function placeCheckIds(roles: TodayRole[], max: number): string[] {
    const unread = roles.map((role) => {
        if (!role.score.components.some(descriptionCanSettle)) return role;
        // As it would score if the description opened it to them: its total from before the cap for being outside.
        const { outside, ...score } = role.score;
        return {
            ...role,
            score: {
                ...score,
                total: outside?.total ?? score.total,
                components: score.components.map((c) =>
                    descriptionCanSettle(c) ? { ...c, reason: "remote_anywhere" as const, unknown: false } : c,
                ),
            },
        };
    });
    return pickToday(unread, { skipped: new Set(), tracked: new Set() })
        .filter(({ job }) => needsPlaceCheck(job))
        .slice(0, max)
        .map(({ job }) => job.id);
}

/**
 * The roles with what their descriptions say about place (`notes`), each
 * noted role scored again so a role limited to another country reads as
 * abroad and leaves the picks. Roles without a note are unchanged.
 */
export function withPlaceNotes(
    roles: TodayRole[],
    notes: Readonly<Record<string, PlaceRestriction | null>>,
    rescore: (job: PublicJob) => MatchScore | null,
): TodayRole[] {
    return roles.flatMap((role) => {
        const note = notes[role.job.id];
        if (!note) return [role];
        const job = { ...role.job, place_restriction: note };
        const score = rescore(job);
        return score ? [{ job, score }] : [];
    });
}

/**
 * The picks in the order to show them after the visitor's ratings: the same
 * nudges that reorder a pack's roles (`tuneDeck`, shared through
 * tuning-store.ts), so a thumbs up here and one in a pack tune one list.
 * `held` (rows the visitor has rated or acted past, in order) stay where
 * they are; the rest move, each inside its own fit band and never a title the
 * résumé does not hold above one it does (`tuneRank`).
 */
export function tuneToday(
    picks: TodayRole[],
    nudges: readonly TuningNudge[],
    held: readonly string[],
    nowMs: number,
): TodayRole[] {
    const jobs = picks.map((r) => r.job);
    const byId = new Map(picks.map((r) => [r.job.id, r]));
    const tuned = tuneDeck(jobs, nudges, held, nowMs, (job) => {
        const role = byId.get(job.id);
        return role ? tuneRank(role.score, job, nowMs) : null;
    });
    if (tuned === jobs) return picks;
    return tuned.map((job) => byId.get(job.id)).filter((r): r is TodayRole => r != null);
}

/** Posted since the last visit (`sinceMs`); nothing is "new" on a first visit. */
export function isNewSince(job: PublicJob, sinceMs: number | null): boolean {
    if (sinceMs == null) return false;
    const posted = derivePostedTs(job);
    return posted != null && posted >= sinceMs;
}

/**
 * A pick is new when this device hadn't listed it before this sitting
 * (`seenBefore`, `readTodaySeen`). Roles reach search hours after they're
 * posted, so "posted since the last visit" never counted one posted just
 * before a visit and listed just after it, and Today said "0 new picks today"
 * while new roles kept arriving (2026-10-06). A device that has kept no list
 * yet falls back to the posting date; on a first visit every pick is new.
 */
export function isNewPick(job: PublicJob, seenBefore: ReadonlySet<string> | null, sinceMs: number | null): boolean {
    if (seenBefore) return !seenBefore.has(job.id);
    return sinceMs == null || isNewSince(job, sinceMs);
}

/** What the visit store holds: when this device last opened the home, and the sitting's baseline. */
export type TodayVisit = { lastSeenAt: string | null; since: string | null };

/**
 * The baseline for this load, and what to store for the next one. A first
 * visit has no baseline (`sinceMs: null`, "this week"). A load within
 * `TODAY_SESSION_GAP_MS` of the last keeps the sitting's baseline; a later
 * one moves it to the previous visit.
 */
export function resolveTodaySince(stored: TodayVisit, nowMs: number): { sinceMs: number | null; next: TodayVisit } {
    const nowIso = new Date(nowMs).toISOString();
    const lastSeenMs = parseMs(stored.lastSeenAt);
    if (lastSeenMs == null) return { sinceMs: null, next: { lastSeenAt: nowIso, since: null } };
    if (nowMs - lastSeenMs < TODAY_SESSION_GAP_MS) {
        return { sinceMs: parseMs(stored.since), next: { lastSeenAt: nowIso, since: stored.since } };
    }
    return { sinceMs: lastSeenMs, next: { lastSeenAt: nowIso, since: stored.lastSeenAt } };
}

/** The posted-at floor the new-since search uses: the baseline, or a week back on a first visit. */
export function todaySearchFloor(sinceMs: number | null, nowMs: number): number {
    return sinceMs ?? nowMs - TODAY_FIRST_VISIT_LOOKBACK_MS;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When the baseline was, in the visitor's own words and time zone: "earlier
 * today", "yesterday", a weekday within the last week, else "Sep 12".
 * `null` (a first visit) has no "last here".
 */
export function formatLastHere(sinceMs: number | null, nowMs: number): string | null {
    if (sinceMs == null) return null;
    const today = startOfLocalDay(nowMs);
    const day = startOfLocalDay(sinceMs);
    const daysAgo = Math.round((today - day) / DAY_MS);
    if (daysAgo <= 0) return "earlier today";
    if (daysAgo === 1) return "yesterday";
    const at = new Date(sinceMs);
    if (daysAgo < 7) return WEEKDAYS[at.getDay()];
    return `${MONTHS[at.getMonth()]} ${at.getDate()}`;
}

/** The phrase the stat and the list heading end with: "since Tuesday", "this week". */
export function sincePhrase(sinceMs: number | null, nowMs: number): string {
    const last = formatLastHere(sinceMs, nowMs);
    if (last == null) return "this week";
    return last === "earlier today" ? "today" : `since ${last}`;
}

/**
 * Today's summary in sentences, each saying what its number counts: the picks
 * and the next thing to do with them, then the applications. A part is `null`
 * when there is nothing to say (no picks shown: the list's own empty state
 * speaks; no applications: no line about them).
 */
export interface TodaySummary {
    /** "2 new roles fit you since Tuesday." · "No new roles fit you since yesterday." · "5 roles posted this week fit you." */
    picks: string | null;
    /** The step after "Next:": "Apply to the role below, or give it a thumbs down so it stops showing." */
    next: string | null;
    /** "You applied to 1 role today." */
    appliedToday: string | null;
    /** "11 applications are waiting on a reply": the tracker's Applied stage, the page it opens. */
    waiting: string | null;
}

export function todaySummary(input: {
    /** The picks have loaded and at least `shown` of them are listed. */
    ready: boolean;
    /** Rows the list shows. */
    shown: number;
    /** Picks this device hadn't listed before (`isNewPick`); every pick on a first visit. */
    newCount: number;
    firstVisit: boolean;
    /** `sincePhrase`. */
    since: string;
    appliedToday: number;
    /** Applications in the tracker's Applied stage. */
    appliedWaiting: number;
}): TodaySummary {
    const { ready, shown, newCount, firstVisit, since, appliedToday, appliedWaiting } = input;
    const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
    let picks: string | null = null;
    let next: string | null = null;
    if (ready && shown > 0) {
        const sinceText = since === "today" ? "since you were here earlier today" : since;
        if (firstVisit) {
            // Every pick on a first visit is this week's: count the rows listed, so the line never reads 0 above two roles
            // (2026-10-14: "0 roles posted this week fit you" over two picks this device had listed before).
            picks = `${shown} ${s(shown, "role", "roles")} posted this week ${s(shown, "fits", "fit")} you.`;
            next = shown === 1 ? "Look at it below and apply if it suits you." : "Look at them below and apply to the ones that suit you.";
        } else if (newCount > 0) {
            picks = `${newCount} new ${s(newCount, "role fits", "roles fit")} you ${sinceText}.`;
            next =
                newCount === 1
                    ? "It's at the top, marked New. Apply if it suits you."
                    : "They're at the top, marked New. Apply to the ones that suit you.";
        } else {
            picks = `No new roles fit you ${sinceText}.`;
            next =
                shown === 1
                    ? "Apply to the role below, or give it a thumbs down so it stops showing."
                    : "Apply to the roles below that suit you, and give the rest a thumbs down so they stop showing.";
        }
    }
    return {
        picks,
        next,
        appliedToday: appliedToday > 0 ? `You applied to ${appliedToday} ${s(appliedToday, "role", "roles")} today.` : null,
        waiting:
            appliedWaiting > 0
                ? `${appliedWaiting} ${s(appliedWaiting, "application is", "applications are")} waiting on a reply`
                : null,
    };
}

const SKIPPED_KEY = "intervu.today.skipped";
const VISIT_KEY = "intervu.today.visit";
const SEEN_KEY = "intervu.today.seen";
const SKIPPED_CAP = 300;
const SEEN_CAP = 600;

/** The roles this device has shown in Today or at the top of a fit-ranked list (`isNewPick`, `pickToday`, `sortByFit`), or `null` when it has kept no list yet. */
export function readTodaySeen(): Set<string> | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "null");
        return Array.isArray(raw) ? new Set(raw.filter((id): id is string => typeof id === "string")) : null;
    } catch {
        return null;
    }
}

/** Add the picks just listed; the oldest drop off past `SEEN_CAP`. */
export function writeTodaySeen(ids: readonly string[]): void {
    if (typeof window === "undefined") return;
    try {
        const kept = [...(readTodaySeen() ?? [])].filter((id) => !ids.includes(id));
        localStorage.setItem(SEEN_KEY, JSON.stringify([...kept, ...ids].slice(-SEEN_CAP)));
    } catch {
        /* private mode / quota */
    }
}

export function readTodaySkipped(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? "[]");
        return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
    } catch {
        return new Set();
    }
}

/** Remember a skip; the oldest drop off past `SKIPPED_CAP`. */
export function writeTodaySkipped(ids: ReadonlySet<string>): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(SKIPPED_KEY, JSON.stringify([...ids].slice(-SKIPPED_CAP)));
    } catch {
        /* private mode / quota */
    }
}

export function readTodayVisit(): TodayVisit {
    if (typeof window === "undefined") return { lastSeenAt: null, since: null };
    try {
        const raw = JSON.parse(localStorage.getItem(VISIT_KEY) ?? "null");
        return {
            lastSeenAt: typeof raw?.lastSeenAt === "string" ? raw.lastSeenAt : null,
            since: typeof raw?.since === "string" ? raw.since : null,
        };
    } catch {
        return { lastSeenAt: null, since: null };
    }
}

export function writeTodayVisit(visit: TodayVisit): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(VISIT_KEY, JSON.stringify(visit));
    } catch {
        /* private mode / quota */
    }
}
