"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { ConceptALandingHydration } from "@/components/onboarding/ConceptALandingHydration";
import {
    CONCEPT_A_LANDING_PENDING_HTML_CLASS,
    JOBS_SKIP_LANDING_HTML_CLASS,
    readOnboardingCompletedFromStorage,
    subscribeOnboardingCompleted,
} from "@/lib/jobs/onboarding-first-paint";
import type { JobsContentProps } from "@/app/jobs/JobsContent";
import { requireAuthKitSoon } from "@/lib/perf/schedule-after-load-or-idle";

const JobsContent = dynamic(
    () => import("@/app/jobs/JobsContent").then((m) => ({ default: m.JobsContent })),
    { ssr: false, loading: () => null },
);

function hideLandingShell() {
    const root = document.documentElement;
    root.classList.add(JOBS_SKIP_LANDING_HTML_CLASS);
    // Keep lean chrome hidden until onboarding is done — avoids landing Sign in
    // stacking with TopBar Sign in while steps 2–3 run.
    if (readOnboardingCompletedFromStorage()) {
        root.classList.remove(CONCEPT_A_LANDING_PENDING_HTML_CLASS);
    }
    document.body.classList.remove("concept-a-landing-active");
}

function JobsContentEntry(props: JobsContentProps) {
    useEffect(() => {
        hideLandingShell();
    }, []);
    return (
        <Suspense fallback={null}>
            <JobsContent {...props} />
        </Suspense>
    );
}

/**
 * Signed-out Step 1 ships SSR poster + this gate only (no /jobs mega-bundle).
 * Loads JobsContent after CTA/sign-in or when onboarding was already completed.
 */
export default function JobsRouteGate() {
    const onboardingDismissed = useSyncExternalStore(
        subscribeOnboardingCompleted,
        readOnboardingCompletedFromStorage,
        () => false,
    );
    const [entry, setEntry] = useState<JobsContentProps | null>(() =>
        readOnboardingCompletedFromStorage() ? {} : null,
    );

    useEffect(() => {
        if (onboardingDismissed) {
            requireAuthKitSoon();
            setEntry((prev) => prev ?? {});
        }
    }, [onboardingDismissed]);

    useEffect(() => {
        if (entry) hideLandingShell();
    }, [entry]);

    useEffect(() => {
        const prefetch = () => {
            void import("@/app/jobs/JobsContent");
        };
        if (typeof requestIdleCallback !== "undefined") {
            const id = requestIdleCallback(prefetch, { timeout: 4000 });
            return () => cancelIdleCallback(id);
        }
        const t = window.setTimeout(prefetch, 2500);
        return () => window.clearTimeout(t);
    }, []);

    if (entry) {
        return <JobsContentEntry {...entry} />;
    }

    return (
        <>
            <ConceptALandingHydration
                onStart={() => {
                    requireAuthKitSoon();
                    setEntry({ onboardingInitialStep: 2 });
                }}
                onSignIn={() => {
                    requireAuthKitSoon();
                    setEntry({ onboardingInitialStep: 2, openAuthOnMount: true });
                }}
            />
            <div id="jobs-route-gate-inert" data-testid="jobs-route-loading-inert" className="hidden" aria-hidden />
        </>
    );
}
