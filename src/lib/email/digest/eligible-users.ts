/**
 * Every uid with at least one followed company or saved search — the
 * universe a digest run walks. `collectionGroup` scans across every user's
 * subcollection of that name; a plain unfiltered `.select()` (field-less
 * projection, cheapest possible read) needs no composite index.
 */
import { getAdminDb } from "@/lib/firebase/admin";

export async function listDigestEligibleUids(): Promise<string[]> {
  const db = getAdminDb();
  const [follows, searches] = await Promise.all([
    db.collectionGroup("followedCompanies").select().get(),
    db.collectionGroup("savedSearches").select().get(),
  ]);

  const uids = new Set<string>();
  for (const doc of [...follows.docs, ...searches.docs]) {
    const uid = doc.ref.parent.parent?.id;
    if (uid) uids.add(uid);
  }
  return [...uids];
}
