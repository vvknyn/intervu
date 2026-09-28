"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
    isSharedJobPath,
    readOnboardingCompletedFromStorage,
    restoreJobsSsrLanding,
    revealSharedJobHeader,
} from "@/lib/jobs/onboarding-first-paint";

/**
 * The jobs layout wraps both the hub and `/jobs/[slug]`. Client navigations
 * do not re-run the head script, so a shared job has to clear the hub's
 * chrome-hide classes itself. Leaving the slug for `/jobs` restores Step 1
 * only when onboarding is still incomplete.
 */
export function SharedJobHeaderGuard() {
    const pathname = usePathname() ?? "";
    useLayoutEffect(() => {
        if (!isSharedJobPath(pathname)) return;
        revealSharedJobHeader();
        return () => {
            if (window.location.pathname === "/jobs" && !readOnboardingCompletedFromStorage()) {
                restoreJobsSsrLanding();
            }
        };
    }, [pathname]);
    return null;
}
