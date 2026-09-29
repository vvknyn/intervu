"use client";

/**
 * The viewed-jobs read path — the shared `createServerListCache` (one fetch
 * per session, shared across every mounted consumer). `job_views` has
 * exactly one write path (`recordJobViewAction`, called only from
 * `openJob`), reflected here via `markViewed`'s optimistic local state, so
 * no mutator invalidates this cache; the one invalidation is `retry` after
 * a failed read.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { getJobViewsAction } from "@/actions/views";
import { createServerListCache } from "@/lib/server-list-cache";
import type { JobView } from "@/lib/views/types";
import { buildViewedSet } from "@/lib/views/viewed-set";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import {
    subscribeRecentlyViewed,
    getRecentlyViewedSnapshot,
    getRecentlyViewedServerSnapshot,
} from "@/lib/jobs/recently-viewed";

const server = createServerListCache(getJobViewsAction);

export interface UseViewedResult {
    /** Server-fetched rows, newest-first, already capped — see
     *  `orderJobViewsLatestFirst`. The /yours/history page's data source. */
    entries: JobView[];
    /** Server + local-store + this-render's optimistic ids, unioned via the
     *  same `buildViewedSet` the SERP hide-viewed filter uses. */
    viewedIds: Set<string>;
    loading: boolean;
    /** The signed-in read failed after its automatic retry — render
     *  `LoadFailedState`, never the empty state. */
    failed: boolean;
    retry: () => void;
    /** Optimistic local add — `openJob` (jobs/page.tsx) calls this alongside
     *  the fire-and-forget `recordJobViewAction` so a just-opened job reads
     *  as viewed immediately, without waiting on the round trip. */
    markViewed: (jobId: string) => void;
}

export function useViewed(): UseViewedResult {
    const [user, setUser] = useState(() => getCurrentUser());
    const [entries, setEntries] = useState<JobView[]>(() => (user ? (server.peek() ?? []) : []));
    const [loading, setLoading] = useState(!!user && !server.peek());
    const [failed, setFailed] = useState(false);
    const [optimisticIds, setOptimisticIds] = useState<Set<string>>(() => new Set());

    useEffect(() => onAuthChange(setUser), []);

    useEffect(() => {
        let cancelled = false;
        if (!user) {
            setEntries([]);
            setLoading(false);
            setFailed(false);
            return;
        }
        const refresh = () => {
            setLoading(!server.peek());
            server.fetch().then((res) => {
                if (cancelled) return;
                if (res.ok) setEntries(res.data);
                setFailed(!res.ok);
                setLoading(false);
            });
        };
        refresh();
        const unsubscribe = server.subscribe(refresh);
        return () => {
            cancelled = true;
            unsubscribe();
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

    return { entries, viewedIds, loading, failed, retry: server.invalidate, markViewed };
}
