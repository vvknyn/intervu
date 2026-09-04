import type { Queryable } from "../pg/pool";

/**
 * Deletes every ledger row owned by one WorkOS user id.
 *
 * The only deletion path onto `intervu.telemetry_events` outside the
 * retention reaper (`scripts/reap-telemetry.ts`) — reached exclusively
 * through `forgetIdentity` (src/lib/identity/forget.ts), the single
 * "delete everything about this address" chokepoint (#247 lesson).
 *
 * Returns the number of rows actually removed (via `RETURNING`), never an
 * assumed count — a caller that needs proof of deletion reads this number,
 * not just whether the promise resolved.
 */
export async function deleteTelemetryByUserId(q: Queryable, userId: string): Promise<number> {
  const { rows } = await q.query<{ id: number }>(
    `DELETE FROM intervu.telemetry_events WHERE user_id = $1 RETURNING id`,
    [userId],
  );
  return rows.length;
}
