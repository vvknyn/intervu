/**
 * Daily picks: the roles Velai emails a signed-in person once a day, at most
 * `DAILY_PICKS_MAX`, for people who turned it on. They are Today's picks
 * (`pickToday`, `todayLeftOut`): the person's own line of work, at their
 * level (never above it, and never managing people when the résumé shows no
 * one managed, #855), where they can work, Strong or Good. A Stretch role is
 * never one.
 *
 * A role goes out once. The account keeps what it was sent (`DailyPicksSent`),
 * by id and by opening (`sameRoleKey`), so a re-posted copy of a role already
 * sent doesn't come back as new. No AI anywhere: the picks and each one's
 * reason come from the score (`explainMatch`).
 *
 * Pure, no I/O: the daily run (collect.ts), the MCP `daily_picks` tool and
 * Today's pinning (`pinEmailed`) all use it.
 */
import { type TrackedIndex, type TrackedLike } from "@/lib/pursuits/applied";
import { pickToday, sameRoleKey, type TodayRole } from "@/lib/jobs/for-you/today";
import type { PublicJob } from "@/lib/jobs/types";

/** Roles in one email. */
export const DAILY_PICKS_MAX = 5;

/** Sent roles remembered, newest kept: about four months at five a day. */
export const DAILY_PICKS_SENT_CAP = 600;

/** A run this soon after the last email sends nothing: a cron that fires twice, or a manual run. */
export const DAILY_PICKS_MIN_GAP_MS = 20 * 60 * 60_000;

/** How long Today keeps the last email's picks at the top: until the next email, at most this long. */
export const DAILY_PICKS_PIN_MS = 48 * 60 * 60_000;

/** What an account has already been sent: role ids, and the openings they were (`sentKey`). */
export interface DailyPicksSent {
    ids: readonly string[];
    keys: readonly string[];
}

export const NOTHING_SENT: DailyPicksSent = { ids: [], keys: [] };

/** The opening a role is (`sameRoleKey`: company, title, place), in a form any store keeps. */
export function sentKey(job: PublicJob): string {
    return sameRoleKey(job).split("\0").join("|");
}

/**
 * Today's picks for this account, best first (`pickToday`): what a tracked
 * role or a role already emailed can't be. Roles already emailed are not
 * dropped here, only ordered after the rest (`seenBefore`), so a list of the
 * day's picks (the MCP tool) still shows them.
 */
export function rankDailyPicks(
    roles: TodayRole[],
    opts: { tracked: ReadonlySet<string>; sent: DailyPicksSent; applied?: TrackedIndex<TrackedLike>; nowMs?: number },
): TodayRole[] {
    return pickToday(roles, { skipped: new Set(), tracked: opts.tracked, seenBefore: new Set(opts.sent.ids), applied: opts.applied, nowMs: opts.nowMs });
}

/** Whether a role, or another listing of the same opening, has been emailed to this account. */
export function wasSent(job: PublicJob, sent: DailyPicksSent): boolean {
    return sent.ids.includes(job.id) || sent.keys.includes(sentKey(job));
}

/** The next email's roles: the best of the ranked picks not sent before, at most `DAILY_PICKS_MAX`. */
export function chooseDailyPicks(ranked: TodayRole[], sent: DailyPicksSent): TodayRole[] {
    const ids = new Set(sent.ids);
    const keys = new Set(sent.keys);
    return ranked.filter((r) => !ids.has(r.job.id) && !keys.has(sentKey(r.job))).slice(0, DAILY_PICKS_MAX);
}

/** What the account has been sent once `jobs` go out, newest last, capped at `DAILY_PICKS_SENT_CAP`. */
export function rememberSent(sent: DailyPicksSent, jobs: readonly PublicJob[]): DailyPicksSent {
    const add = (kept: readonly string[], next: string[]) =>
        [...kept.filter((value) => !next.includes(value)), ...next].slice(-DAILY_PICKS_SENT_CAP);
    return { ids: add(sent.ids, jobs.map((job) => job.id)), keys: add(sent.keys, jobs.map(sentKey)) };
}

/** The last email's picks for Today to pin, while that email is recent (`DAILY_PICKS_PIN_MS`). */
export function emailedToPin(latest: { ids: readonly string[]; sentAt: string | null }, nowMs: number): string[] {
    const sentMs = latest.sentAt ? Date.parse(latest.sentAt) : NaN;
    if (Number.isNaN(sentMs) || nowMs - sentMs > DAILY_PICKS_PIN_MS || nowMs < sentMs - 60_000) return [];
    return [...latest.ids];
}

/**
 * The roles with the ones the last email named first, in the email's order,
 * and the rest in their own order after them. A role the email named that
 * isn't in `roles` (rated down here, or tracked since) stays out.
 */
export function pinEmailed<T extends { job: { id: string } }>(roles: T[], emailed: readonly string[]): T[] {
    if (emailed.length === 0) return roles;
    const rank = new Map(emailed.map((id, i) => [id, i]));
    const pinned = roles.filter((r) => rank.has(r.job.id)).sort((a, b) => rank.get(a.job.id)! - rank.get(b.job.id)!);
    if (pinned.length === 0) return roles;
    return [...pinned, ...roles.filter((r) => !rank.has(r.job.id))];
}
