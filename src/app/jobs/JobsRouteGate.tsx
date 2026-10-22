"use client";

import { Suspense, useLayoutEffect, useSyncExternalStore } from "react";
import { JobsContent, type InitialSearch } from "@/app/jobs/JobsContent";
import { earlyFirstSearchParams, startEarlyFirstSearch } from "@/lib/jobs/early-first-search";
import { getSuppressLocationDefaultSnapshot } from "@/lib/jobs/location-default-preference";
import { searchJobs } from "@/lib/jobs/search-client";
import type { JobsInitial } from "@/lib/jobs/server-entry";
import { seedServerSession } from "@/lib/firebase/client-auth";
import { resumePresence } from "@/lib/resume/use-resume-presence";
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
 * résumé gets the résumé band on the board, and a new account its setup in
 * place of the band (components/onboarding/).
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
 *
 * A signed-in visitor gets the same: /jobs is decided on the server
 * (server-entry.ts), which either redirects to their résumé-ranked search or
 * renders the list here with `initial`, their session and résumé presence
 * already settled, so no frame shows a state the browser had yet to discover.
 *
 * A signed-out visitor opening bare /jobs gets the same treatment from
 * /jobs/front-door (`signedOut`, server-front-door.ts): the front door
 * renders on the server with sign-in state already settled, so the masthead
 * and the résumé band paint with the HTML instead of after the page's code
 * and a session check.
 */
export default function JobsRouteGate({
    initialSearch = null,
    signedOut = false,
    initial = null,
}: {
    initialSearch?: InitialSearch | null;
    signedOut?: boolean;
    /** The signed-in visitor's session and résumé presence, read on the server. */
    initial?: JobsInitial | null;
}) {
    // False while hydrating, true after.
    const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

    // A layout effect, so it runs before JobsContent's own (passive) search
    // effect even when both mount in one commit, as on a client navigation.
    useLayoutEffect(() => {
        // Before any passive effect, so the header's and tab bar's own reads replay these.
        if (initial) {
            seedServerSession(initial.user);
            if (initial.resumeOnFile !== null) resumePresence.seed(initial.user.uid, initial.resumeOnFile);
        }
        if (initialSearch) {
            startEarlyFirstSearch(initialSearch.params, () => Promise.resolve(initialSearch.result));
            return;
        }
        const params = earlyFirstSearchParams(window.location.search, getSuppressLocationDefaultSnapshot());
        if (params) startEarlyFirstSearch(params, searchJobs);
        // Mount-only, like the list's own first search; `initialSearch` and `initial` never change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const renderedOnServer = initialSearch != null || signedOut || initial != null;
    if (!mounted && !renderedOnServer) return null;
    const content = <JobsContent initialSearch={initialSearch} signedOutOnServer={signedOut} initial={initial} />;
    // The prerendered page needs the boundary (the list reads the address,
    // which a prerender leaves to the browser). The pages that render the
    // list on the server are dynamic and go without: React streams a
    // finished boundary over ~12.8 KB apart from the page and shows it on
    // the next animation frame, which on a busy phone came after the page's
    // scripts had run, so the list painted no sooner than it does in the
    // browser.
    if (renderedOnServer) return content;
    return <Suspense fallback={null}>{content}</Suspense>;
}
