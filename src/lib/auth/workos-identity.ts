/**
 * Turning a WorkOS user into the app's notion of a signed-in user.
 *
 * Deliberately free of imports. The session read lives in `server-user.ts`,
 * which pulls in `@workos-inc/authkit-nextjs` — an ESM-only package that cannot
 * be loaded by the unit-test runner. Keeping the decision here is what makes it
 * testable at all, and this is the one decision in the auth path that can lose
 * someone their data.
 */

export interface ServerUser {
  /**
   * The Firebase uid for every migrated user, and the WorkOS user id for
   * anyone who signs up after the cutover. Either way it is stable for the
   * life of the account, which is what the Firestore keys require.
   */
  uid: string;
  email?: string;
  displayName?: string;
}

/** The fields this resolver reads off a WorkOS user. */
export interface WorkosIdentity {
  id: string;
  externalId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** `username` is set here (not `firstName`) for a password signup — a
   *  username is a label, not a person's name, and WorkOS's own `name`
   *  field is surfaced back to the user in places (e.g. its dashboard) a
   *  made-up first name would look wrong. See `toServerUser`'s fallback. */
  metadata?: Record<string, string> | null;
}

/**
 * Resolve a WorkOS user to a `ServerUser`.
 *
 * `uid` prefers `externalId` because the migration stores each Firebase uid
 * there, and Firestore keys every document by it (`profiles`, `applications`,
 * `tailored_resumes`, `search_events` all carry `user_id`). Get this wrong and
 * a returning user signs in successfully and finds an empty account — nothing
 * errors, which is what makes it the dangerous field.
 *
 * `displayName` prefers a real first/last name (Google sign-in) and falls
 * back to `metadata.username` (password signup) — the same label Firebase's
 * `displayName` carried before this migration, for the UI surfaces
 * (TopBar, Settings, YourResumeSection) that already render it.
 */
export function toServerUser(user: WorkosIdentity): ServerUser {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    uid: user.externalId || user.id,
    email: user.email ?? undefined,
    displayName: name || user.metadata?.username || undefined,
  };
}
