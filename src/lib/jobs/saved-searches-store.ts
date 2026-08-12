/**
 * Server-only Firestore access for a user's server-side `savedSearches`
 * subcollection. Deliberately its own file, NOT added to
 * `lib/jobs/saved-searches.ts` — that module is client-shared (its
 * `hasLocalStorage()` guest-store functions are imported by client
 * components), so pulling `firebase-admin` into it would break the client
 * bundle. Split out of `actions/saved-searches.ts` for the same reason
 * `lib/follows/store.ts` was split out of `actions/follows.ts`: a
 * `"use server"` file's exports must all be async Server Actions.
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { SavedSearch } from "./saved-searches";

export function savedSearchesCollection(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("savedSearches");
}

export function docToSavedSearch(snap: FirebaseFirestore.DocumentSnapshot): SavedSearch {
  const data = snap.data()!;
  return {
    id: snap.id,
    name: data.name,
    href: data.params,
    createdAt: data.createdAt,
  };
}
