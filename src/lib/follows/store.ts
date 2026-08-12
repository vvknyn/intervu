/**
 * Server-only Firestore access for `followedCompanies` — split out of
 * `actions/follows.ts` because that file has `"use server"` at the top,
 * and Next.js requires every export of a `"use server"` file to be an
 * async Server Action (a plain sync helper like a collection-ref builder
 * or a doc mapper breaks the build). Mirrors the split already established
 * between `lib/jobs/saved-searches.ts` (plain) and `actions/saved-
 * searches.ts` (`"use server"`).
 */
import { getAdminDb } from "@/lib/firebase/admin";
import type { FollowedCompany } from "./types";

export function followedCompaniesCollection(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("followedCompanies");
}

export function docToFollowedCompany(snap: FirebaseFirestore.DocumentSnapshot): FollowedCompany {
  const data = snap.data()!;
  return {
    domain: data.domain ?? snap.id,
    slug: data.slug,
    displayName: data.displayName,
    createdAt: data.createdAt,
  };
}
