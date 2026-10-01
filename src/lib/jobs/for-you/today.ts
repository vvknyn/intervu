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
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";
import { tuneDeck, type TuningNudge } from "@/lib/jobs/for-you/tuning";
import { compareFit, matchBand, type MatchScore } from "@/lib/match/score";
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
 * Why a scored role is not one of today's picks, or `null` when it is one.
 * Today is the short list, so its bar is higher than a pack's, and it is the
 * same for any role or industry because it reads only the score:
 *  - `stretch`: under Good against the résumé;
 *  - `other-role`: the title is not the candidate's own kind of role (a
 *    neighbour the pack also searched for, a title tied to no role the
 *    résumé names, or a different kind of job). Packs still list these;
 *  - `level`: the role asks for more seniority than the résumé shows;
 *  - `abroad`: the role is in, or remote from, a country the candidate
 *    can't work in.
 */
export type TodayLeftOut = "stretch" | "other-role" | "level" | "abroad";

export function todayLeftOut(score: MatchScore): TodayLeftOut | null {
    if (matchBand(score.total) === "stretch") return "stretch";
    if (score.role !== "own" && score.role !== "family") return "other-role";
    const reasons = new Set(score.components.map((c) => c.reason));
    if (reasons.has("level_below_ask")) return "level";
    if (reasons.has("abroad") || reasons.has("remote_abroad")) return "abroad";
    return null;
}

/** The same opening listed twice (re-synced or cross-posted): its title, company and place. A role open in two cities is two openings. */
function sameRoleKey(job: PublicJob): string {
    const norm = (s: string | null | undefined) => decodeText(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    return `${norm(job.company)}\0${norm(job.title)}\0${norm(locationText(job))}`;
}

/**
 * Today's picks, best first: the roles `todayLeftOut` keeps that weren't
 * skipped here and aren't in the tracker, ordered as every ranked list is
 * (`compareFit`: the candidate's own role first, then the higher score),
 * newest first on a tie, each opening once. The visitor's ratings
 * reorder these afterwards (`tuneDeck`).
 */
export function pickToday(
    roles: TodayRole[],
    opts: { skipped: ReadonlySet<string>; tracked: ReadonlySet<string> },
): TodayRole[] {
    const seen = new Set<string>();
    return roles
        .filter((r) => !opts.skipped.has(r.job.id) && !opts.tracked.has(r.job.id) && todayLeftOut(r.score) == null)
        .sort((a, b) => compareFit(a.score, b.score) || (derivePostedTs(b.job) ?? 0) - (derivePostedTs(a.job) ?? 0))
        .filter((r) => {
            const key = sameRoleKey(r.job);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/**
 * The picks in the order to show them after the visitor's ratings: the same
 * nudges that reorder a pack's roles (`tuneDeck`, shared through
 * tuning-store.ts), so a thumbs up here and one in a pack tune one list.
 * `held` (rows the visitor has rated or acted past, in order) stay where
 * they are; the rest move.
 */
export function tuneToday(
    picks: TodayRole[],
    nudges: readonly TuningNudge[],
    held: readonly string[],
    nowMs: number,
): TodayRole[] {
    const jobs = picks.map((r) => r.job);
    const tuned = tuneDeck(jobs, nudges, held, nowMs);
    if (tuned === jobs) return picks;
    const byId = new Map(picks.map((r) => [r.job.id, r]));
    return tuned.map((job) => byId.get(job.id)).filter((r): r is TodayRole => r != null);
}

/** Posted since the last visit (`sinceMs`); nothing is "new" on a first visit. */
export function isNewSince(job: PublicJob, sinceMs: number | null): boolean {
    if (sinceMs == null) return false;
    const posted = derivePostedTs(job);
    return posted != null && posted >= sinceMs;
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

const SKIPPED_KEY = "intervu.today.skipped";
const VISIT_KEY = "intervu.today.visit";
const SKIPPED_CAP = 300;

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
