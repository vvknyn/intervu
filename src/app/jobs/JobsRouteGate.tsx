"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { holdAuthKitUntilRequired, requireAuthKitSoon } from "@/lib/perf/schedule-after-load-or-idle";

// Runs when this module loads, before hydration: start downloading
// JobsContent alongside hydration instead of after this gate mounts, and keep
// AuthKit's session action from queuing ahead of the first search.
// JobsContent lifts the hold once its first search settles; the timer is a
// backstop if it never does.
if (typeof window !== "undefined") {
    void import("@/app/jobs/JobsContent");
    holdAuthKitUntilRequired();
    window.setTimeout(requireAuthKitSoon, 10_000);
}

const JobsContent = dynamic(
    () => import("@/app/jobs/JobsContent").then((m) => ({ default: m.JobsContent })),
    { ssr: false, loading: () => null },
);

/**
 * /jobs is board-first for everyone: the search box and job rows straight
 * away, with no poster or step flow ahead of them, signed in or out. Sign-up
 * is asked for at persist actions (save, alert, apply); an account without a
 * résumé gets the résumé band on the board, and the importer over it right
 * after sign-up (`?resume=gate`, handled inside JobsContent).
 */
export default function JobsRouteGate() {
    return (
        <Suspense fallback={null}>
            <JobsContent />
        </Suspense>
    );
}
