"use client";

import { Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { ConceptALandingHydration } from "@/components/onboarding/ConceptALandingHydration";
import {
    readOnboardingCompletedFromStorage,
    subscribeOnboardingCompleted,
    hideJobsSsrLanding,
} from "@/lib/jobs/onboarding-first-paint";
import type { JobsContentProps } from "@/app/jobs/JobsContent";
import { requireAuthKitSoon } from "@/lib/perf/schedule-after-load-or-idle";
import { onAuthChange, revalidateClientSession } from "@/lib/firebase/client-auth";
import { hasPostAuthResumeGateParam } from "@/lib/auth/post-auth-destination";

const JobsContent = dynamic(
    () => import("@/app/jobs/JobsContent").then((m) => ({ default: m.JobsContent })),
    { ssr: false, loading: () => null },
);

function JobsContentEntry(props: JobsContentProps) {
    useLayoutEffect(() => {
        hideJobsSsrLanding();
        const id = requestAnimationFrame(() => hideJobsSsrLanding());
        return () => cancelAnimationFrame(id);
    }, []);
    return (
        <Suspense fallback={null}>
            <JobsContent {...props} />
        </Suspense>
    );
}

function isPostAuthJobsLanding(): boolean {
    if (typeof window === "undefined") return false;
    return hasPostAuthResumeGateParam(`${window.location.pathname}${window.location.search}`);
}

function promoteJobsEntry(prev: JobsContentProps | null, props?: JobsContentProps): JobsContentProps {
    if (prev) return prev;
    return props ?? {};
}

function postAuthEntryProps(): JobsContentProps {
    return { onboardingInitialStep: 2 };
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
    const [entry, setEntry] = useState<JobsContentProps | null>(() => {
        if (readOnboardingCompletedFromStorage()) return {};
        if (isPostAuthJobsLanding()) return postAuthEntryProps();
        return null;
    });

    useEffect(() => {
        if (onboardingDismissed) {
            requireAuthKitSoon();
            setEntry((prev) => promoteJobsEntry(prev));
        }
    }, [onboardingDismissed]);

    useEffect(() => {
        if (!isPostAuthJobsLanding()) return;
        requireAuthKitSoon();
        hideJobsSsrLanding();
        revalidateClientSession();
        setEntry((prev) => promoteJobsEntry(prev, postAuthEntryProps()));
    }, []);

    useEffect(() => {
        const unsub = onAuthChange((user) => {
            if (!user) return;
            requireAuthKitSoon();
            hideJobsSsrLanding();
            revalidateClientSession();
            setEntry((prev) => promoteJobsEntry(prev, postAuthEntryProps()));
        });
        return unsub;
    }, []);

    useEffect(() => {
        if (entry) hideJobsSsrLanding();
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
                    hideJobsSsrLanding();
                    setEntry({ onboardingInitialStep: 2 });
                }}
                onSignIn={() => {
                    requireAuthKitSoon();
                    hideJobsSsrLanding();
                    setEntry({ onboardingInitialStep: 2 });
                }}
            />
            <div id="jobs-route-gate-inert" data-testid="jobs-route-loading-inert" className="hidden" aria-hidden />
        </>
    );
}
