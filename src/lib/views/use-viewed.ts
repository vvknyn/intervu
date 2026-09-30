"use client";

/**
 * The viewed-jobs read path — the shared `createServerListCache` (one fetch
 * per session, shared across every mounted consumer). `job_views` has
 * exactly one write path (`recordJobViewAction`, sent only by `recordJobView`
 * below), reflected here via `markViewed`'s optimistic ids and the
 * session-views notes (`session-views.ts`), so no mutator invalidates this
 * cache; the one invalidation is `retry` after a failed read.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getJobViewsAction, recordJobViewAction } from "@/actions/views";
import { createServerListCache } from "@/lib/server-list-cache";
import type { JobView } from "@/lib/views/types";
import type { JobSnapshot } from "@/lib/pursuits/types";
import { buildViewedSet } from "@/lib/views/viewed-set";
import { getCurrentUser, onAuthChange } from "@/lib/firebase/client-auth";
import {
    subscribeRecentlyViewed,
    getRecentlyViewedSnapshot,
    getRecentlyViewedServerSnapshot,
} from "@/lib/jobs/recently-viewed";
import {
    getSessionViewsServerSnapshot,
    getSessionViewsSnapshot,
    mergeSessionViews,
    noteSessionView,
    subscribeSessionViews,
} from "@/lib/views/session-views";

const server = createServerListCache(getJobViewsAction);

/**
 * The one client call for "the visitor deliberately opened this job" (a SERP
 * row via `openJob`, a pack row via the deck). Notes it for this page's
 * lists at once and sends the `job_views` write the first time this page
 * sees the job. Signed-out, the action records nothing and `entries` stays
 * empty, so the note is inert.
 */
export function recordJobView(jobId: string, snapshot: JobSnapshot): void {
    if (noteSessionView(jobId, snapshot)) {
        void recordJobViewAction(jobId, snapshot).catch(() => {});
    }
}

export interface UseViewedResult {
    /** Server-fetched rows with this page's opens folded in
     *  (`mergeSessionViews`), newest-first, already capped — see
     *  `orderJobViewsLatestFirst`. The /yours/history page's and the packs
     *  hub's Recently viewed data source. */
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

    const sessionViews = useSyncExternalStore(
        subscribeSessionViews,
        getSessionViewsSnapshot,
        getSessionViewsServerSnapshot,
    );
    const mergedEntries = useMemo(
        () => (user ? mergeSessionViews(entries, sessionViews) : entries),
        [user, entries, sessionViews],
    );

    // Server rows only: a pack row opened this session must not drop out of
    // its own list under "hide viewed" (see session-views.ts).
    const viewedIds = buildViewedSet(
        entries.map((v) => v.job_id),
        localEntries.map((v) => v.id),
        optimisticIds,
    );

    const markViewed = (jobId: string) => {
        setOptimisticIds((prev) => (prev.has(jobId) ? prev : new Set(prev).add(jobId)));
    };

    return { entries: mergedEntries, viewedIds, loading, failed, retry: server.invalidate, markViewed };
}
