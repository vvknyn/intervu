/**
 * Client-side session stores that must reset when WorkOS auth ends.
 *
 * Module-level caches (saved searches, follows, pursuits) and in-memory résumé
 * state can outlive the httpOnly cookie — a deep-linked /jobs URL that
 * rehydrates from those stores without re-checking the live session is how
 * signed-in chrome ghosts after sign-out.
 */

import { clearLocalAiResume } from "@/lib/local-ai/resume-storage";
import { clearSavedSearches } from "@/lib/jobs/saved-searches";
import { invalidateSavedSearchesCache } from "@/lib/jobs/use-saved-searches";
import { invalidateFollowsCache } from "@/lib/follows/use-follows";
import { invalidatePursuitsCache } from "@/lib/pursuits/use-pursuits";
import { forgetOnboarding } from "@/hooks/use-onboarding";

/** The For you / Search choice an earlier release kept in this browser: nothing reads it now, sign-out still forgets it. */
const LEGACY_JOBS_HOME_VIEW_KEY = "intervu.jobs.homeView";

function clearStorageKey(key: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(key);
    } catch {
        /* private mode */
    }
}

/** Drop every client store that can paint signed-in /jobs chrome. */
export function clearSessionClientStores(): void {
    invalidateSavedSearchesCache();
    invalidateFollowsCache();
    invalidatePursuitsCache();
    clearSavedSearches();
    clearLocalAiResume();
    clearStorageKey(LEGACY_JOBS_HOME_VIEW_KEY);
    forgetOnboarding();
}
