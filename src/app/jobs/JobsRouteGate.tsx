"use client";

import { Suspense, useLayoutEffect, useSyncExternalStore } from "react";
import { searchJobsAction } from "@/actions/jobs";
import { JobsContent } from "@/app/jobs/JobsContent";
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
 */
export default function JobsRouteGate() {
    // False while hydrating (the server rendered nothing here), true after.
    const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

    // A layout effect, so it runs before JobsContent's own (passive) search
    // effect even when both mount in one commit, as on a client navigation.
    useLayoutEffect(() => {
        const params = earlyFirstSearchParams(window.location.search, getSuppressLocationDefaultSnapshot());
        if (params) startEarlyFirstSearch(params, searchJobsAction);
    }, []);

    if (!mounted) return null;
    return (
        <Suspense fallback={null}>
            <JobsContent />
        </Suspense>
    );
}
