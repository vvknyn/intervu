import type { Queryable } from "@/lib/pg/pool";

/**
 * Daily cap on AI resume-parse calls, per signed-in user.
 *
 * Billing removal (2026-08-27) deleted the credit ledger that used to bound
 * this call — every upload now runs free on the app's own shared key, so
 * something has to replace credits as the abuse brake, or a scripted upload
 * loop has no ceiling at all. A fixed per-day window keyed on the user's own
 * counter row is the simplest thing that bounds it; unlike the in-memory
 * per-IP limiters in lib/shield/rate-limit.ts and lib/agent/rate-limit.ts,
 * this needs a real user identity (an IP is the wrong axis for "how many
 * times has THIS account parsed today") and a 24h window is too long to
 * trust to a module-scope Map that a deploy restart silently zeroes — so it
 * is backed by the identity Postgres store instead (getIntervuPg()), the one
 * DB-backed seam the app already has outside the box pipeline pool.
 *
 * Deliberately its own table, not a repurposed column on
 * `intervu.identities` — that table is scoped to the anonymous
 * email-follow identity (see lib/identity/store.ts), a different concern
 * from an authenticated app user's parse count.
 */
export const RESUME_PARSE_DAILY_LIMIT = 10;

/**
 * Pure decision: is another parse allowed given how many this user has
 * already made today? Unit-testable without a database — same
 * pure-decision/thin-I/O split as `checkRateLimitWindow` in
 * lib/shield/rate-limit.ts.
 */
export function resolveParseRateLimit(
  countToday: number,
  limit: number = RESUME_PARSE_DAILY_LIMIT,
): boolean {
  return countToday < limit;
}

/** Thin I/O: how many parses this user has already made today (0 if none yet). */
export async function getResumeParseCountToday(q: Queryable, userUid: string): Promise<number> {
  const { rows } = await q.query<{ count: number }>(
    `SELECT count FROM intervu.resume_parse_counters
     WHERE user_uid = $1 AND window_date = current_date`,
    [userUid],
  );
  return rows[0]?.count ?? 0;
}

/** Thin I/O: record one parse attempt for this user today, creating the row on first use. */
export async function recordResumeParseAttempt(q: Queryable, userUid: string): Promise<void> {
  await q.query(
    `INSERT INTO intervu.resume_parse_counters (user_uid, window_date, count)
     VALUES ($1, current_date, 1)
     ON CONFLICT (user_uid, window_date)
     DO UPDATE SET count = intervu.resume_parse_counters.count + 1`,
    [userUid],
  );
}
