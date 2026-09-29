/**
 * The Today header on the packs home: what changed since the visitor last
 * looked, and what is theirs to do now. Pure helpers only; the component
 * (`components/jobs/for-you/TodayHome.tsx`) owns the search and storage.
 *
 * "New since your last visit" is per device, like every other visit cursor
 * in the product (`visit-cursor.ts`). A reload inside one sitting keeps the
 * same baseline, so the list doesn't empty itself the moment it is read.
 */
import { derivePostedTs } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";
import { matchBand, type MatchScore } from "@/lib/match/score";
import { startOfLocalDay } from "@/lib/pursuits/daily-apply-plan";
import { isStalePursuit } from "@/lib/pursuits/tracker-display";
import type { Pursuit } from "@/lib/pursuits/types";

const DAY_MS = 86_400_000;

/** An application with no status change for this long is due a follow-up. */
export const TODAY_FOLLOW_UP_DAYS = 7;

/** How far ahead "interviews this week" looks. */
export const TODAY_INTERVIEW_WINDOW_DAYS = 7;

/** Rows the header lists before "See more". */
export const TODAY_NEW_ROWS = 5;

/** Roles the new-since search reads (newest first) before scoring. */
export const TODAY_NEW_FETCH_LIMIT = 40;

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

/** Interviews from the start of today through the next week: soonest first. */
export function interviewsThisWeek(pursuits: Pursuit[], nowMs: number): Pursuit[] {
    const from = startOfLocalDay(nowMs);
    const to = nowMs + TODAY_INTERVIEW_WINDOW_DAYS * DAY_MS;
    return pursuits
        .filter((p) => {
            if (CLOSED_STAGES.has(p.status)) return false;
            const at = parseMs(p.interview_date);
            return at != null && at >= from && at <= to;
        })
        .sort((a, b) => (parseMs(a.interview_date) ?? 0) - (parseMs(b.interview_date) ?? 0));
}

export type TodayRole = { job: PublicJob; score: MatchScore };

/**
 * The roles worth a look: Strong or Good against the résumé, posted since the
 * baseline, not skipped here and not already in the tracker. Strong before
 * Good, then newest first.
 */
export function pickNewForYou(
    roles: TodayRole[],
    opts: { sinceMs: number; skipped: ReadonlySet<string>; tracked: ReadonlySet<string> },
): TodayRole[] {
    const rank = (r: TodayRole) => (matchBand(r.score.total) === "strong" ? 0 : 1);
    return roles
        .filter((r) => {
            if (opts.skipped.has(r.job.id) || opts.tracked.has(r.job.id)) return false;
            if (matchBand(r.score.total) === "stretch") return false;
            const posted = derivePostedTs(r.job);
            return posted != null && posted >= opts.sinceMs;
        })
        .sort((a, b) => rank(a) - rank(b) || (derivePostedTs(b.job) ?? 0) - (derivePostedTs(a.job) ?? 0));
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
