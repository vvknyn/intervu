/**
 * The one "delete everything about this address" path, per the #247 lesson
 * (an account-deletion sweep that named its own collections left saved
 * resumes behind): (a) the unsubscribe route's `forget=1` variant and (b)
 * `deleteAccount` (`actions/auth.ts`, the one the UI calls) both funnel
 * through here rather than each doing their own PG delete + suppression
 * call.
 *
 * Suppression ALWAYS runs, even when PG is unconfigured or the identity
 * doesn't exist there — a PG outage must never block someone's unsubscribe.
 * Reuses the EXISTING `suppress` helper and `UnsubscribeScope`'s "all"
 * value (no new scope invented) so this sits on the same suppression
 * chokepoint every other unsubscribe path already goes through.
 *
 * Deps-injected (same shape as `submitFollowEmail`/`sendEmailFollowDigests`)
 * so the decision — suppress first, then delete if a store is available —
 * is unit-testable without Firestore or a database connection.
 */
import type { Queryable } from "../pg/pool";
import { deleteIdentityByEmail } from "./store";
import { suppress, type SuppressionReason } from "../email/suppression";
import type { UnsubscribeScope } from "../email/unsubscribe-token";

export interface ForgetIdentityDeps {
  suppress(email: string, scope: UnsubscribeScope, reason: SuppressionReason): Promise<void>;
  deleteIdentity(q: Queryable, email: string): Promise<boolean>;
}

const defaultDeps: ForgetIdentityDeps = {
  suppress,
  deleteIdentity: deleteIdentityByEmail,
};

export async function forgetIdentity(
  q: Queryable | null,
  email: string,
  deps: ForgetIdentityDeps = defaultDeps,
): Promise<void> {
  await deps.suppress(email, "all", "unsubscribed");
  if (q) await deps.deleteIdentity(q, email);
}
