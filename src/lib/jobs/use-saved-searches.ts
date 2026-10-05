"use client";

/**
 * Shared saved-searches read-path — signed-in users fetch once (module
 * cache); signed-out users read the guest localStorage store. Mirrors
 * `lib/follows/use-follows.ts` line-for-line, substituting types.
 *
 * Unlike follows (which keeps a dedicated `guest-store.ts` clear of any
 * client-auth import), `lib/jobs/saved-searches.ts` already plays both
 * roles — it's imported by the `"use server"` actions file too — so it
 * stays untouched by this file's auth import; `loadSavedSearches` /
 * `clearSavedSearches` / `subscribeSavedSearches` from that module ARE the
 * guest store for this feature.
 */

import { useEffect, useState } from "react";
import { createServerListCache } from "@/lib/server-list-cache";
import { listSavedSearchesAction, saveSavedSearchAction, syncGuestSavedSearchesAction } from "@/actions/saved-searches";
import { takePendingSavedSearch } from "@/lib/jobs/pending-saved-search";
import { captureEvent } from "@/lib/analytics/events";
import { noteSetupFacts } from "@/hooks/use-onboarding";
import {
    loadSavedSearches,
    clearSavedSearches,
    subscribeSavedSearches,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";

const server = createServerListCache(listSavedSearchesAction);

export function invalidateSavedSearchesCache(): void {
    server.invalidate();
}

/** @returns true when there was nothing to sync or every guest row landed. */
export async function syncGuestSavedSearchesToServer(): Promise<boolean> {
    const guests = loadSavedSearches();
    if (guests.length === 0) return true;

    const result = await syncGuestSavedSearchesAction(guests);
    if (!result.error) {
        clearSavedSearches();
        invalidateSavedSearchesCache();
        return true;
    }
    return false;
}

/**
 * Saves the search a guest signed in to save (pending-saved-search.ts).
 * @returns its name once saved, or null when there was none or the save failed.
 */
export async function savePendingSearchAfterSignIn(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    const pending = takePendingSavedSearch(window.sessionStorage);
    if (!pending) return null;
    const result = await saveSavedSearchAction(pending).catch(() => ({ error: "Failed to save search" }));
    if (result.error) return null;
    invalidateSavedSearchesCache();
    captureEvent("saved_search_created", { surface: "after_sign_in", signed_in: true });
    // A saved search is what setup's weekly-email step asks for.
    noteSetupFacts({ savedSearches: 1 });
    return pending.name;
}

export interface UseSavedSearchesResult {
    saved: SavedSearch[];
    loading: boolean;
    /** The signed-in read failed after its automatic retry — render
     *  `LoadFailedState`, never the empty state. */
    failed: boolean;
    retry: () => void;
}

export function useSavedSearches(): UseSavedSearchesResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [saved, setSaved] = useState<SavedSearch[]>(() => (user ? (server.peek() ?? []) : loadSavedSearches()));
    const [loading, setLoading] = useState(!!user && !server.peek());
    const [failed, setFailed] = useState(false);

    useEffect(
        () =>
            onAuthChange((nextUser) => {
                setUser(nextUser);
                if (!nextUser) {
                    invalidateSavedSearchesCache();
                    setSaved(loadSavedSearches());
                    setLoading(false);
                    setFailed(false);
                }
            }),
        [],
    );

    useEffect(() => {
        let cancelled = false;
        const signedIn = !!user;

        const refresh = () => {
            if (cancelled) return;
            if (!signedIn) {
                setSaved(loadSavedSearches());
                setLoading(false);
                setFailed(false);
                return;
            }
            const pendingGuest = loadSavedSearches();
            if (pendingGuest.length > 0) {
                setSaved(pendingGuest);
                setLoading(false);
                setFailed(false);
                return;
            }
            setLoading(!server.peek());
            server.fetch().then((res) => {
                if (cancelled) return;
                if (res.ok) setSaved(res.data);
                setFailed(!res.ok);
                setLoading(false);
            });
        };

        Promise.resolve().then(refresh);
        const unsubServer = server.subscribe(refresh);
        const unsubGuest = subscribeSavedSearches(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    return { saved, loading, failed, retry: invalidateSavedSearchesCache };
}
