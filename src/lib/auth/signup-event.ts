/**
 * The one place that decides "this sign-in is a brand-new account, report
 * `signup_completed` for it" — for every door (AuthKit callback and password
 * `signUp`).
 *
 * Two facts, neither of them the `metadata.apps` tag:
 *
 *   1. WorkOS's own `user.createdAt` — a fact stamped at creation. A returning
 *      user, a legacy Firebase-migrated user, or a second provider linked to an
 *      existing account all carry an old `createdAt`, so they never qualify.
 *      The freshness window only has to exclude those; the claim below is what
 *      makes the event at-most-once.
 *   2. A durable, atomic once-per-uid claim on the existing `profiles/<uid>`
 *      doc. A retried callback, a second tab, or a password signup followed by
 *      a Google sign-in on the same uid all lose the claim.
 *
 * The previous signal was `!hasApp(metadata.apps, intervu)`, a tag that
 * `provisionAppAccess` writes later in `after()`, best-effort. Until (and
 * unless) that write landed, every sign-in looked like a signup.
 *
 * No new collection: `welcome_emails` is skipped for minted addresses and
 * released on a failed send, so it cannot serve as a once-ever record.
 */
import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

/** Generous on purpose: magic-auth/passkey creation and callback can be minutes apart. */
export const SIGNUP_FRESHNESS_MS = 60 * 60 * 1000;
export const SIGNUP_CLAIM_FIELD = "signup_event_at";

/** Pure: was this WorkOS account created inside the freshness window? */
export function isNewAccount(createdAt: string, now: number): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created <= SIGNUP_FRESHNESS_MS;
}

/**
 * Atomically claim the single `signup_completed` for `uid`. Resolves false when
 * already claimed. An UNKNOWN error also resolves false, loudly logged: of the
 * two ways to be wrong, a missed signup event is recoverable and a duplicate
 * inflates the north-star metric with no way to tell.
 */
export async function claimSignupOnProfile(db: Firestore, uid: string): Promise<boolean> {
  const ref = db.collection("profiles").doc(uid);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get(SIGNUP_CLAIM_FIELD)) return false;
      tx.set(ref, { [SIGNUP_CLAIM_FIELD]: new Date().toISOString() }, { merge: true });
      return true;
    });
  } catch (err) {
    console.error(`[signup-event] claim failed for uid=${uid}:`, err);
    return false;
  }
}

export interface SignupEventDeps {
  claim(uid: string): Promise<boolean>;
  now(): number;
}

export const realSignupEventDeps: SignupEventDeps = {
  claim: (uid) => claimSignupOnProfile(getAdminDb(), uid),
  now: Date.now,
};

/** True exactly once per account: the first time a fresh account is seen, by any door. */
export async function claimSignupEvent(
  user: { id: string; externalId?: string | null; createdAt: string },
  deps: SignupEventDeps = realSignupEventDeps,
): Promise<boolean> {
  if (!isNewAccount(user.createdAt, deps.now())) return false;
  return deps.claim(user.externalId || user.id);
}
