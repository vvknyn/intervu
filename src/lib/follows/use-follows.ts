"use client";

/**
 * Shared follows read-path — signed-in users fetch once (module cache);
 * signed-out users read the guest localStorage store. Sync at sign-in
 * mirrors `use-pursuits.ts` guest→auth merge.
 */

import { useEffect, useState } from "react";
import { createServerListCache } from "@/lib/server-list-cache";
import { listFollowsAction, syncGuestFollowsAction } from "@/actions/follows";
import type { FollowedCompany } from "@/lib/follows/types";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { listGuestFollows, clearGuestFollows, subscribeGuestFollows } from "@/lib/follows/guest-store";

const server = createServerListCache(listFollowsAction);

export function invalidateFollowsCache(): void {
    server.invalidate();
}

/** @returns true when there was nothing to sync or every guest row landed. */
export async function syncGuestFollowsToServer(): Promise<boolean> {
    const guests = listGuestFollows();
    if (guests.length === 0) return true;

    const result = await syncGuestFollowsAction(guests);
    if (!result.error) {
        clearGuestFollows();
        invalidateFollowsCache();
        return true;
    }
    return false;
}

/**
 * Pure: which of the raw follow rows count as a confirmed, channel-backed
 * "following" set. Signed out, `follows` is sourced from the guest-store
 * bookmark (see `useFollows` below) — a bookmark with no server row and no
 * address to email, so none of it may render as "Following" (the
 * "how can I follow when I have not shared an email" bug). Signed in,
 * `follows` already came from the account's Firestore rows, so every row
 * counts.
 */
export function visibleFollowDomains(isSignedIn: boolean, follows: FollowedCompany[]): Map<string, FollowedCompany> {
    const map = new Map<string, FollowedCompany>();
    if (!isSignedIn) return map;
    for (const f of follows) map.set(f.domain, f);
    return map;
}

export interface UseFollowsResult {
    follows: FollowedCompany[];
    loading: boolean;
    /** The signed-in read failed after its automatic retry — render
     *  `LoadFailedState`, never the empty state. */
    failed: boolean;
    retry: () => void;
    hasAny: boolean;
    /**
     * Account-backed follows only (Firestore, keyed by uid) — the source of
     * truth for rendering "Following". A signed-out guest-store bookmark is
     * not a real notification channel (no server row, no address to email),
     * so it never lands here even though it's still in `follows` for
     * pull-based surfaces (e.g. FollowAlertsDialog) that don't claim to push
     * an email. See docs/specs — guest follows exist only as sign-in
     * migration intent (`syncGuestFollowsToServer`).
     */
    byDomain: Map<string, FollowedCompany>;
    /** So a caller (FollowButton) can scope a guest-only signal — like a
     *  verified-email prop — to guests only, instead of letting it leak
     *  into an already-signed-in render. */
    isSignedIn: boolean;
}

export function useFollows(): UseFollowsResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [follows, setFollows] = useState<FollowedCompany[]>(() => (user ? (server.peek() ?? []) : listGuestFollows()));
    const [loading, setLoading] = useState(!!user && !server.peek());
    const [failed, setFailed] = useState(false);

    useEffect(
        () =>
            onAuthChange((nextUser) => {
                setUser(nextUser);
                if (!nextUser) {
                    invalidateFollowsCache();
                    setFollows(listGuestFollows());
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
                setFollows(listGuestFollows());
                setLoading(false);
                setFailed(false);
                return;
            }
            const pendingGuest = listGuestFollows();
            if (pendingGuest.length > 0) {
                setFollows(pendingGuest);
                setLoading(false);
                setFailed(false);
                return;
            }
            setLoading(!server.peek());
            server.fetch().then((res) => {
                if (cancelled) return;
                if (res.ok) setFollows(res.data);
                setFailed(!res.ok);
                setLoading(false);
            });
        };

        Promise.resolve().then(refresh);
        const unsubServer = server.subscribe(refresh);
        const unsubGuest = subscribeGuestFollows(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    const byDomain = visibleFollowDomains(!!user, follows);

    return { follows, loading, failed, retry: invalidateFollowsCache, hasAny: follows.length > 0, byDomain, isSignedIn: !!user };
}
