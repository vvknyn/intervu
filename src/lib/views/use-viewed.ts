"use client";

/**
 * The viewed-jobs read path — mirrors `use-pursuits.ts`'s module-level
 * cache-with-inflight-dedup (one fetch per session, shared across every
 * mounted consumer) but deliberately drops that hook's pub-sub
 * invalidation: `job_views` has exactly one write path (`recordJobViewAction`,
 * called only from `openJob`), reflected here via `markViewed`'s optimistic
 * local state, so there's no second mutator anywhere that needs to tell
 * other mounted consumers to re-fetch.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { getJobViewsAction } from "@/actions/views";
import type { JobView } from "@/lib/views/types";
import { buildViewedSet } from "@/lib/views/viewed-set";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import {
    subscribeRecentlyViewed,
    getRecentlyViewedSnapshot,
    getRecentlyViewedServerSnapshot,
} from "@/lib/jobs/recently-viewed";

let cache: JobView[] | null = null;
let inflight: Promise<JobView[]> | null = null;

async function fetchServerViews(): Promise<JobView[]> {
    if (cache) return cache;
    if (!inflight) {
        inflight = getJobViewsAction()
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

export interface UseViewedResult {
    /** Server-fetched rows, newest-first, already capped — see
     *  `orderJobViewsLatestFirst`. The /yours/history page's data source. */
    entries: JobView[];
    /** Server + local-store + this-render's optimistic ids, unioned via the
     *  same `buildViewedSet` the SERP hide-viewed filter uses. */
    viewedIds: Set<string>;
    loading: boolean;
    /** Optimistic local add — `openJob` (jobs/page.tsx) calls this alongside
     *  the fire-and-forget `recordJobViewAction` so a just-opened job reads
     *  as viewed immediately, without waiting on the round trip. */
    markViewed: (jobId: string) => void;
}

export function useViewed(): UseViewedResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [entries, setEntries] = useState<JobView[]>(() => (user ? (cache ?? []) : []));
    const [loading, setLoading] = useState(!!user && !cache);
    const [optimisticIds, setOptimisticIds] = useState<Set<string>>(() => new Set());

    useEffect(() => onAuthChange(setUser), []);

    useEffect(() => {
        let cancelled = false;
        if (!user) {
            setEntries([]);
            setLoading(false);
            return;
        }
        setLoading(!cache);
        fetchServerViews().then((data) => {
            if (!cancelled) {
                setEntries(data);
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [user]);

    const localEntries = useSyncExternalStore(
        subscribeRecentlyViewed,
        getRecentlyViewedSnapshot,
        getRecentlyViewedServerSnapshot,
    );

    const viewedIds = buildViewedSet(
        entries.map((v) => v.job_id),
        localEntries.map((v) => v.id),
        optimisticIds,
    );

    const markViewed = (jobId: string) => {
        setOptimisticIds((prev) => (prev.has(jobId) ? prev : new Set(prev).add(jobId)));
    };

    return { entries, viewedIds, loading, markViewed };
}
