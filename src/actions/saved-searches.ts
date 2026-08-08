"use server";

import { getServerUser } from "@/lib/firebase/auth-session";
import { getAdminDb } from "@/lib/firebase/admin";
import { savedSearchId, mergedSavedSearchRow, type SavedSearch } from "@/lib/jobs/saved-searches";

function savedSearchesCollection(uid: string) {
    return getAdminDb().collection("users").doc(uid).collection("savedSearches");
}

function docToSavedSearch(snap: FirebaseFirestore.DocumentSnapshot): SavedSearch {
    const data = snap.data()!;
    return {
        id: snap.id,
        name: data.name,
        href: data.params,
        createdAt: data.createdAt,
    };
}

export async function listSavedSearchesAction(): Promise<{ data?: SavedSearch[]; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const snapshot = await savedSearchesCollection(user.uid).orderBy("createdAt", "desc").get();
        return { data: snapshot.docs.map(docToSavedSearch) };
    } catch (error) {
        console.error("Error listing saved searches:", error);
        return { error: error instanceof Error ? error.message : "Failed to list saved searches" };
    }
}

export async function saveSavedSearchAction(input: {
    name: string;
    href: string;
}): Promise<{ data?: SavedSearch; error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const name = input.name.trim();
        const href = input.href.trim();
        if (!name || !href) return { error: "Name and search are required" };

        const id = savedSearchId(href);
        const ref = savedSearchesCollection(user.uid).doc(id);
        const existing = await ref.get();
        const now = new Date().toISOString();
        const createdAt = existing.exists ? (existing.data()?.createdAt ?? now) : now;

        await ref.set({ name, params: href, createdAt });
        return { data: { id, name, href, createdAt } };
    } catch (error) {
        console.error("Error saving search:", error);
        return { error: error instanceof Error ? error.message : "Failed to save search" };
    }
}

export async function deleteSavedSearchAction(id: string): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };

        const trimmed = id.trim();
        if (!trimmed) return { error: "Id is required" };

        await savedSearchesCollection(user.uid).doc(trimmed).delete();
        return {};
    } catch (error) {
        console.error("Error deleting saved search:", error);
        return { error: error instanceof Error ? error.message : "Failed to delete saved search" };
    }
}

/**
 * Merge guest localStorage saved searches at sign-in — same trigger-point
 * shape as `syncGuestFollowsAction` (follows.ts): the caller pushes every
 * guest row, then (on success) clears its own local store. Doc id is the
 * content hash (`savedSearchId`), so running this again on a repeat login —
 * before the guest store is cleared, or from a second device with the same
 * saved search — upserts the same row rather than duplicating it.
 */
export async function syncGuestSavedSearchesAction(
    guestSearches: SavedSearch[],
): Promise<{ error?: string }> {
    try {
        const user = await getServerUser();
        if (!user) return { error: "User not authenticated" };
        if (guestSearches.length === 0) return {};

        const col = savedSearchesCollection(user.uid);
        const results = await Promise.all(
            guestSearches.map(async (guest) => {
                const href = guest.href.trim();
                const name = guest.name.trim();
                if (!href || !name) return { error: "Name and search are required" };

                const ref = col.doc(savedSearchId(href));
                const existing = await ref.get();
                const row = mergedSavedSearchRow(
                    guest,
                    existing.exists ? existing.data()?.createdAt : undefined,
                );

                await ref.set({ name: row.name, params: row.href, createdAt: row.createdAt });
                return {};
            }),
        );

        const failed = results.find((r) => r.error);
        return failed?.error ? { error: failed.error } : {};
    } catch (error) {
        console.error("Error syncing guest saved searches:", error);
        return { error: error instanceof Error ? error.message : "Failed to sync guest saved searches" };
    }
}
