"use client";

/**
 * The one shared pursuits read-path — the root page, /yours, and TopBar all
 * consume this instead of each fetching independently. Fixes the old
 * `appliedIds` bug at its root (root page.tsx, pre-PR2): that was
 * session-only React state, so a reload forgot which jobs were tracked. This
 * fetches the signed-in user's pursuits ONCE (module-level cache, shared
 * across every mounted consumer) and every consumer derives whatever view it
 * needs from the same list; a signed-out user reads localStorage instead.
 *
 * `invalidatePursuitsCache` is the one write-side hook — every mutation
 * (go-after, mark-applied, a stage change on /yours/[id]) calls it so every
 * mounted consumer re-fetches on its next render.
 */

import { useEffect, useState } from "react";
import { getApplications, upsertPursuitForJob } from "@/actions/application";
import type { Pursuit } from "@/lib/pursuits/types";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import { listGuestPursuits, clearGuestPursuits, subscribeGuestPursuits } from "@/lib/pursuits/guest-store";

let cache: Pursuit[] | null = null;
let inflight: Promise<Pursuit[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

async function fetchServerPursuits(): Promise<Pursuit[]> {
    if (cache) return cache;
    if (!inflight) {
        inflight = getApplications()
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

/** Every mutation calls this so all mounted consumers re-fetch. */
export function invalidatePursuitsCache(): void {
    cache = null;
    inflight = null;
    notify();
}

/**
 * Merge-at-sign-in (spec §3, §7): push every guest pursuit to the server —
 * `upsertPursuitForJob` keeps whichever stage is more advanced per job_id —
 * then clear local storage. Callers (root page, /yours) guard this behind
 * their own `useRef` so it runs at most once per page load.
 */
export async function syncGuestPursuitsToServer(): Promise<void> {
    const guests = listGuestPursuits().filter((g): g is Pursuit & { job_id: string } => !!g.job_id);
    if (guests.length === 0) return;
    await Promise.all(
        guests.map((g) =>
            upsertPursuitForJob(
                {
                    job_id: g.job_id,
                    title: g.job_snapshot?.title ?? g.position,
                    company: g.job_snapshot?.company ?? g.company_name,
                    location: g.job_snapshot?.location ?? null,
                    description: g.job_snapshot?.description ?? null,
                    apply_url: g.job_snapshot?.apply_url ?? g.job_url ?? "",
                },
                g.status,
            ),
        ),
    );
    clearGuestPursuits();
    invalidatePursuitsCache();
}

export interface UsePursuitsResult {
    pursuits: Pursuit[];
    loading: boolean;
    hasAny: boolean;
    /** job_id → pursuit, for an O(1) "does this job already have a pursuit" check. */
    byJobId: Map<string, Pursuit>;
}

export function usePursuits(): UsePursuitsResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [pursuits, setPursuits] = useState<Pursuit[]>(() => (user ? (cache ?? []) : listGuestPursuits()));
    const [loading, setLoading] = useState(!!user && !cache);

    useEffect(() => onAuthChange(setUser), []);

    // Re-read on mount/user-change and whenever the server cache or the
    // guest store is invalidated elsewhere (another mounted consumer's
    // mutation). Each `refresh` call below runs inside an async continuation
    // (a subscription callback or a `.then`), never synchronously as the
    // effect's first statement.
    useEffect(() => {
        let cancelled = false;
        const signedIn = !!user;

        const refresh = () => {
            if (cancelled) return;
            if (!signedIn) {
                setPursuits(listGuestPursuits());
                setLoading(false);
                return;
            }
            setLoading(!cache);
            fetchServerPursuits().then((data) => {
                if (!cancelled) {
                    setPursuits(data);
                    setLoading(false);
                }
            });
        };

        // Kick off the first read via a microtask rather than synchronously,
        // so this effect's own body never calls setState directly.
        Promise.resolve().then(refresh);
        const unsubServer = subscribe(refresh);
        const unsubGuest = subscribeGuestPursuits(refresh);
        return () => {
            cancelled = true;
            unsubServer();
            unsubGuest();
        };
    }, [user]);

    const byJobId = new Map<string, Pursuit>();
    for (const p of pursuits) if (p.job_id) byJobId.set(p.job_id, p);

    return { pursuits, loading, hasAny: pursuits.length > 0, byJobId };
}
