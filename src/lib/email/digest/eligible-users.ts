/**
 * The universe a digest run walks.
 *
 * Three signals make someone eligible — a followed company, a saved search,
 * or a tracker entry — because each is a person telling us what they want
 * to hear about. `collectionGroup` scans across every user's subcollection
 * of that name; a plain unfiltered `.select()` (field-less projection, the
 * cheapest possible read) needs no composite index.
 *
 * Eligibility is deliberately generous and cheap: it decides who to LOOK
 * at, not who to email. `collectDigestForUser` returns null for anyone with
 * nothing new, and `assembleDigest` drops empty sections, so a uid appearing
 * here costs a read and nothing more.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import { listAppUsers } from "@/lib/auth/user-directory";
import { APP_INTERVU } from "@/lib/auth/app-tag";
import { isDefaultDigestEnabled } from "./default-section";

/**
 * Every intervu-tagged uid the directory knows about — the eligibility set
 * when the default lane is on, since then "has told us something" stops
 * being a precondition for an email. Yields `legacyUid`, not the Supabase
 * row id: every downstream digest read (`collectDigestForUser`,
 * `getDigestCursor`, ...) keys Firestore by the pre-migration Firebase uid
 * on a migrated account, and by the Supabase id itself on a native one —
 * exactly what `legacyUid` resolves to. `listAppUsers` itself paginates and
 * filters to `app_metadata.apps` containing "intervu" (user-directory.ts),
 * so this can't silently pick up subspace's accounts, and a silent
 * truncation here would look exactly like "those users had nothing new",
 * which is the failure mode that hid 22,853 employers in the jobs.ca
 * harvest.
 */
async function listAllUids(): Promise<string[]> {
  const uids: string[] = [];
  for await (const user of listAppUsers(APP_INTERVU)) {
    uids.push(user.legacyUid);
  }
  return uids;
}

export async function listDigestEligibleUids(): Promise<string[]> {
  // A strict superset of the three signal sets, so there is nothing to
  // union in — every uid below is already in `listAllUids()`.
  if (isDefaultDigestEnabled()) return listAllUids();

  const db = getAdminDb();
  const [follows, searches, pursuits] = await Promise.all([
    db.collectionGroup("followedCompanies").select().get(),
    db.collectionGroup("savedSearches").select().get(),
    // `applications` is a TOP-LEVEL collection keyed by a `user_id` field,
    // not a subcollection under `users/{uid}` like the other two — so the
    // uid is read from the document, not from its parent path. Projecting
    // that single field keeps this the same cheap read as the scans above.
    db.collection("applications").select("user_id").get(),
  ]);

  const uids = new Set<string>();
  for (const doc of [...follows.docs, ...searches.docs]) {
    const uid = doc.ref.parent.parent?.id;
    if (uid) uids.add(uid);
  }
  for (const doc of pursuits.docs) {
    const uid = doc.get("user_id");
    if (typeof uid === "string" && uid) uids.add(uid);
  }
  return [...uids];
}
