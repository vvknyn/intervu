/**
 * "Since your last digest" is its own cursor, deliberately separate from
 * the client-side "last visited" cursor (`lib/jobs/visit-cursor.ts`,
 * localStorage-backed) — those answer a different question (what a BROWSER
 * has seen) and don't exist server-side at all, which a cron-triggered
 * digest run has no browser for anyway. One Firestore doc per user,
 * `email_digest_state/{uid}`, holds only `lastSentAt`; reuses
 * `defaultVisitCursor`'s pure "N days back" default rather than
 * re-deriving a lookback window from scratch for a user who's never had a
 * digest sent.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { defaultVisitCursor } from "@/lib/jobs/visit-cursor";

const COLLECTION = "email_digest_state";

export async function getDigestCursor(uid: string): Promise<string> {
  const snap = await getAdminDb().collection(COLLECTION).doc(uid).get();
  const stored = snap.data()?.lastSentAt;
  return typeof stored === "string" && !Number.isNaN(Date.parse(stored)) ? stored : defaultVisitCursor();
}

export async function setDigestCursor(uid: string, iso: string): Promise<void> {
  await getAdminDb().collection(COLLECTION).doc(uid).set({ lastSentAt: iso }, { merge: true });
}
