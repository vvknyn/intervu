"use client";

import { Suspense, useLayoutEffect, useSyncExternalStore } from "react";
import { searchJobsAction } from "@/actions/jobs";
import { JobsContent, type InitialSearch } from "@/app/jobs/JobsContent";
import { earlyFirstSearchParams, startEarlyFirstSearch } from "@/lib/jobs/early-first-search";
import { getSuppressLocationDefaultSnapshot } from "@/lib/jobs/location-default-preference";
import { holdDeferredLoadsUntilFirstList, releaseFirstListHold } from "@/lib/perf/schedule-after-load-or-idle";

// Runs when this module loads, before hydration: keep AuthKit's session
// action and PostHog's download from landing ahead of the first search.
// JobsContent lifts the hold once its first search settles; the timer is a
// backstop if it never does.
if (typeof window !== "undefined") {
    holdDeferredLoadsUntilFirstList();
    window.setTimeout(releaseFirstListHold, 10_000);
}

const subscribeNever = () => () => {};

/**
 * /jobs is board-first for everyone: the search box and job rows straight
 * away, with no poster or step flow ahead of them, signed in or out. Sign-up
 * is asked for at persist actions (save, alert, apply); an account without a
 * résumé gets the résumé band on the board, and the importer over it right
 * after sign-up (`?resume=gate`, handled inside JobsContent).
 *
 * JobsContent is browser-only (it reads storage and the viewport while it
 * renders), so it mounts after hydration. It is imported statically, not
 * through `next/dynamic`: its code then downloads with the page's own
 * scripts instead of being requested only once this gate's module runs,
 * which on a throttled phone profile came ~1.7 s in. The gate also sends a
 * typed search landing's first search before JobsContent's large first
 * render (early-first-search.ts).
 *
 * The exception is a signed-out phone opening a search link, which the
 * middleware sends to /jobs/first-rows: that page searches on the server
 * and passes `initialSearch`, and the list renders there with those rows
 * (server-first-rows.ts). The server sees no storage and no viewport, so it
 * renders what a first visit on a phone sees, which is what the list's
 * storage and viewport reads return while hydrating; it updates from the
 * real values right after. Its first search takes `initialSearch`.
 */
export default function JobsRouteGate({ initialSearch = null }: { initialSearch?: InitialSearch | null }) {
    // False while hydrating, true after.
    const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

    // A layout effect, so it runs before JobsContent's own (passive) search
    // effect even when both mount in one commit, as on a client navigation.
    useLayoutEffect(() => {
        if (initialSearch) {
            startEarlyFirstSearch(initialSearch.params, () => Promise.resolve(initialSearch.result));
            return;
        }
        const params = earlyFirstSearchParams(window.location.search, getSuppressLocationDefaultSnapshot());
        if (params) startEarlyFirstSearch(params, searchJobsAction);
        // Mount-only, like the list's own first search; `initialSearch` never changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!mounted && !initialSearch) return null;
    return (
        <Suspense fallback={null}>
            <JobsContent initialSearch={initialSearch} />
        </Suspense>
    );
}
