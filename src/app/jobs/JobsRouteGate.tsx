"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { requireAuthKitSoon } from "@/lib/perf/schedule-after-load-or-idle";

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
    useEffect(() => {
        requireAuthKitSoon();
    }, []);
    return (
        <Suspense fallback={null}>
            <JobsContent />
        </Suspense>
    );
}
