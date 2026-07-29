"use client";

/**
 * Shared follows read-path — signed-in users fetch once (module cache);
 * signed-out users read the guest localStorage store. Sync at sign-in
 * mirrors `use-pursuits.ts` guest→auth merge.
 */

import { useEffect, useState } from "react";
import { listFollowsAction, syncGuestFollowsAction } from "@/actions/follows";
import type { FollowedCompany } from "@/lib/follows/types";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { listGuestFollows, clearGuestFollows, subscribeGuestFollows } from "@/lib/follows/guest-store";

let cache: FollowedCompany[] | null = null;
let inflight: Promise<FollowedCompany[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

async function fetchServerFollows(): Promise<FollowedCompany[]> {
    if (cache) return cache;
    if (!inflight) {
        inflight = listFollowsAction()
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

export function invalidateFollowsCache(): void {
    cache = null;
    inflight = null;
    notify();
}

export async function syncGuestFollowsToServer(): Promise<void> {
    const guests = listGuestFollows();
    if (guests.length === 0) return;

    const result = await syncGuestFollowsAction(guests);
    if (!result.error) {
        clearGuestFollows();
    }
    invalidateFollowsCache();
}

export interface UseFollowsResult {
    follows: FollowedCompany[];
    loading: boolean;
    hasAny: boolean;
    byDomain: Map<string, FollowedCompany>;
}

export function useFollows(): UseFollowsResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [follows, setFollows] = useState<FollowedCompany[]>(() => (user ? (cache ?? []) : listGuestFollows()));
    const [loading, setLoading] = useState(!!user && !cache);

    useEffect(() => onAuthChange(setUser), []);

    useEffect(() => {
        let cancelled = false;
        const signedIn = !!user;

        const refresh = () => {
            if (cancelled) return;
            if (!signedIn) {
                setFollows(listGuestFollows());
                setLoading(false);
                return;
            }
            setLoading(!cache);
            fetchServerFollows().then((data) => {
                if (!cancelled) {
                    setFollows(data);
                    setLoading(false);
                }
            });
        };

        Promise.resolve().then(refresh);
        const unsubServer = subscribe(refresh);
        const unsubGuest = subscribeGuestFollows(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    const byDomain = new Map<string, FollowedCompany>();
    for (const f of follows) byDomain.set(f.domain, f);

    return { follows, loading, hasAny: follows.length > 0, byDomain };
}
