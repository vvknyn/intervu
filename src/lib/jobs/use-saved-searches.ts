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
import { listSavedSearchesAction, syncGuestSavedSearchesAction } from "@/actions/saved-searches";
import {
    loadSavedSearches,
    clearSavedSearches,
    subscribeSavedSearches,
    type SavedSearch,
} from "@/lib/jobs/saved-searches";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";

let cache: SavedSearch[] | null = null;
let inflight: Promise<SavedSearch[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

async function fetchServerSavedSearches(): Promise<SavedSearch[]> {
    if (cache) return cache;
    if (!inflight) {
        inflight = listSavedSearchesAction()
            .then((res) => {
                cache = res.data ?? [];
                return cache;
            })
            .catch(() => {
                cache = [];
                return cache;
            })
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
}

export function invalidateSavedSearchesCache(): void {
    cache = null;
    inflight = null;
    notify();
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

export interface UseSavedSearchesResult {
    saved: SavedSearch[];
    loading: boolean;
}

export function useSavedSearches(): UseSavedSearchesResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [saved, setSaved] = useState<SavedSearch[]>(() => (user ? (cache ?? []) : loadSavedSearches()));
    const [loading, setLoading] = useState(!!user && !cache);

    useEffect(
        () =>
            onAuthChange((nextUser) => {
                setUser(nextUser);
                if (!nextUser) {
                    invalidateSavedSearchesCache();
                    setSaved(loadSavedSearches());
                    setLoading(false);
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
                return;
            }
            const pendingGuest = loadSavedSearches();
            if (pendingGuest.length > 0) {
                setSaved(pendingGuest);
                setLoading(false);
                return;
            }
            setLoading(!cache);
            fetchServerSavedSearches().then((data) => {
                if (!cancelled) {
                    setSaved(data);
                    setLoading(false);
                }
            });
        };

        Promise.resolve().then(refresh);
        const unsubServer = subscribe(refresh);
        const unsubGuest = subscribeSavedSearches(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    return { saved, loading };
}
