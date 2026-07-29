"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import type { FollowedCompany } from "@/lib/follows/types";

function followedCompaniesCollection(uid: string) {
    return getAdminDb().collection("users").doc(uid).collection("followedCompanies");
}

function earliestCreatedAt(...candidates: (string | undefined)[]): string {
    const valid = candidates.filter((c): c is string => !!c);
    if (valid.length === 0) return new Date().toISOString();
    return valid.reduce((earliest, next) => (Date.parse(next) < Date.parse(earliest) ? next : earliest));
}

function docToFollowedCompany(snap: FirebaseFirestore.DocumentSnapshot): FollowedCompany {
    const data = snap.data()!;
    return {
        domain: data.domain ?? snap.id,
        slug: data.slug,
        displayName: data.displayName,
        createdAt: data.createdAt,
    };
}

export async function listFollowsAction(): Promise<{ data?: FollowedCompany[]; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const snapshot = await followedCompaniesCollection(user.uid).orderBy("createdAt", "desc").get();
        return { data: snapshot.docs.map(docToFollowedCompany) };
    } catch (error) {
        console.error("Error listing follows:", error);
        return { error: error instanceof Error ? error.message : "Failed to list follows" };
    }
}

export async function followCompanyAction(input: {
    domain: string;
    slug: string;
    displayName: string;
}): Promise<{ data?: FollowedCompany; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const domain = input.domain.trim().toLowerCase();
        if (!domain) return { error: "Domain is required" };

        const ref = followedCompaniesCollection(user.uid).doc(domain);
        const existing = await ref.get();
        const now = new Date().toISOString();
        const row: FollowedCompany = {
            domain,
            slug: input.slug.trim(),
            displayName: input.displayName.trim(),
            createdAt: existing.exists ? (existing.data()?.createdAt ?? now) : now,
        };

        await ref.set(row);
        return { data: row };
    } catch (error) {
        console.error("Error following company:", error);
        return { error: error instanceof Error ? error.message : "Failed to follow company" };
    }
}

export async function unfollowCompanyAction(domain: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const normalized = domain.trim().toLowerCase();
        if (!normalized) return { error: "Domain is required" };

        await followedCompaniesCollection(user.uid).doc(normalized).delete();
        return {};
    } catch (error) {
        console.error("Error unfollowing company:", error);
        return { error: error instanceof Error ? error.message : "Failed to unfollow company" };
    }
}

/** Merge guest follows at sign-in — upsert each row, keep earliest createdAt. */
export async function syncGuestFollowsAction(
    guestFollows: FollowedCompany[],
): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };
        if (guestFollows.length === 0) return {};

        const col = followedCompaniesCollection(user.uid);
        const results = await Promise.all(
            guestFollows.map(async (guest) => {
                const domain = guest.domain.trim().toLowerCase();
                if (!domain) return { error: "Domain is required" };

                const ref = col.doc(domain);
                const existing = await ref.get();
                const now = new Date().toISOString();
                const createdAt = earliestCreatedAt(
                    existing.exists ? existing.data()?.createdAt : undefined,
                    guest.createdAt,
                    now,
                );

                await ref.set({
                    domain,
                    slug: guest.slug,
                    displayName: guest.displayName,
                    createdAt,
                });
                return {};
            }),
        );

        const failed = results.find((r) => r.error);
        return failed?.error ? { error: failed.error } : {};
    } catch (error) {
        console.error("Error syncing guest follows:", error);
        return { error: error instanceof Error ? error.message : "Failed to sync guest follows" };
    }
}
