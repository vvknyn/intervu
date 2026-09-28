"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { JobsContentProps } from "@/app/jobs/JobsContent";
import { requireAuthKitSoon } from "@/lib/perf/schedule-after-load-or-idle";
import { hasPostAuthResumeGateParam } from "@/lib/auth/post-auth-destination";

const JobsContent = dynamic(
    () => import("@/app/jobs/JobsContent").then((m) => ({ default: m.JobsContent })),
    { ssr: false, loading: () => null },
);

/** After OAuth the account step is already behind the visitor: open the résumé gate. */
function initialJobsProps(): JobsContentProps {
    if (typeof window === "undefined") return {};
    const isPostAuth = hasPostAuthResumeGateParam(`${window.location.pathname}${window.location.search}`);
    return isPostAuth ? { onboardingInitialStep: 2 } : {};
}

/**
 * /jobs is board-first: signed-out visitors get the search box and job rows
 * straight away — no poster or step flow ahead of them. Sign-up is asked for
 * at persist actions (save, alert, apply). Only a signed-in visitor without a
 * résumé sees the onboarding card, decided inside JobsContent.
 */
export default function JobsRouteGate() {
    const [props] = useState(initialJobsProps);
    useEffect(() => {
        requireAuthKitSoon();
    }, []);
    return (
        <Suspense fallback={null}>
            <JobsContent {...props} />
        </Suspense>
    );
}
