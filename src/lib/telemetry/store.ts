import type { Queryable } from "../pg/pool";

/**
 * Deletes every ledger row owned by one WorkOS user id.
 *
 * The only deletion path onto `intervu.telemetry_events` outside the
 * retention reaper (`scripts/reap-telemetry.ts`) — reached exclusively
 * through `forgetIdentity` (src/lib/identity/forget.ts), the single
 * "delete everything about this address" chokepoint (#247 lesson).
 *
 * Goes through `intervu.forget_telemetry_user`, a SECURITY DEFINER function
 * (deploy/db-box/telemetry-schema.sql §7), rather than issuing the DELETE
 * directly: the connection this runs on carries the `telemetry_pg` role,
 * which is granted INSERT only. Calling the function is what makes the
 * erasure possible without ever handing the internet-facing ingest
 * credential a general delete — or a single SELECT — on the ledger.
 *
 * Returns the number of rows actually removed, read from the statement's own
 * `row_count`, never an assumed count — a caller that needs proof of
 * deletion reads this number, not just whether the promise resolved.
 */
export async function deleteTelemetryByUserId(q: Queryable, userId: string): Promise<number> {
  // bigint arrives from pg as a string; a lost count would silently read as 0.
  const { rows } = await q.query<{ deleted: string | number | null }>(
    `SELECT intervu.forget_telemetry_user($1) AS deleted`,
    [userId],
  );
  return Number(rows[0]?.deleted ?? 0);
}
