/**
 * The one "delete everything about this address" path, per the #247 lesson
 * (an account-deletion sweep that named its own collections left saved
 * resumes behind): (a) the unsubscribe route's `forget=1` variant and (b)
 * `deleteAccount` (`actions/auth.ts`, the one the UI calls) both funnel
 * through here rather than each doing their own PG delete + suppression
 * call.
 *
 * Suppression ALWAYS runs, even when a store is unconfigured or the
 * identity doesn't exist there — a store outage must never block someone's
 * unsubscribe. Reuses the EXISTING `suppress` helper and `UnsubscribeScope`'s
 * "all" value (no new scope invented) so this sits on the same suppression
 * chokepoint every other unsubscribe path already goes through. Any failure
 * further down (PG identity delete, telemetry delete) propagates rather
 * than being swallowed — same as the existing `deleteIdentity` call already
 * behaves — because by the time either can run, the unsubscribe itself has
 * already taken effect.
 *
 * Deps-injected (same shape as `submitFollowEmail`/`sendEmailFollowDigests`)
 * so the decision — suppress first, then delete from whichever stores are
 * available — is unit-testable without Firestore or a database connection.
 */
import type { Queryable } from "../pg/pool";
import { deleteIdentityByEmail } from "./store";
import { deleteTelemetryByUserId } from "../telemetry/store";
import { getWorkosUserManagement, resolveWorkosUidByEmail } from "../auth/workos-runtime";
import { suppress, type SuppressionReason } from "../email/suppression";
import type { UnsubscribeScope } from "../email/unsubscribe-token";

export interface ForgetIdentityDeps {
  suppress(email: string, scope: UnsubscribeScope, reason: SuppressionReason): Promise<void>;
  deleteIdentity(q: Queryable, email: string): Promise<boolean>;
  /**
   * Email -> the `ServerUser.uid` the telemetry ledger's `user_id` column
   * holds (see `resolveWorkosUidByEmail`, auth/workos-runtime.ts), or null
   * when no WorkOS account exists for the address — nothing ever wrote a
   * ledger row under it, so there is nothing to delete.
   */
  resolveWorkosUid(email: string): Promise<string | null>;
  deleteTelemetry(q: Queryable, userId: string): Promise<number>;
}

async function resolveWorkosUid(email: string): Promise<string | null> {
  const userManagement = await getWorkosUserManagement();
  return resolveWorkosUidByEmail(userManagement, email);
}

const defaultDeps: ForgetIdentityDeps = {
  suppress,
  deleteIdentity: deleteIdentityByEmail,
  resolveWorkosUid,
  deleteTelemetry: deleteTelemetryByUserId,
};

export async function forgetIdentity(
  q: Queryable | null,
  telemetryQ: Queryable | null,
  email: string,
  deps: ForgetIdentityDeps = defaultDeps,
): Promise<void> {
  await deps.suppress(email, "all", "unsubscribed");
  if (q) await deps.deleteIdentity(q, email);

  // The ledger's `user_id` can only ever have come from a WorkOS-
  // authenticated session — unrelated to `intervu.identities` above, which
  // is an anonymous email-follow identity, a different concern (see
  // deploy/supabase/identity-schema.sql). So this resolves independently of
  // whether a `deleteIdentity` row existed, gated only on whether a
  // telemetry store is wired and a WorkOS account exists for the address.
  if (telemetryQ) {
    const uid = await deps.resolveWorkosUid(email);
    if (uid) await deps.deleteTelemetry(telemetryQ, uid);
  }
}
