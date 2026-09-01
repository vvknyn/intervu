/**
 * Tracks how many searches a visitor has run in this browser.
 *
 * Nothing renders the count directly, but `submitSearch` (page.tsx) reads it
 * back from the increment it just made to decide whether to offer the
 * signed-in email nudge — see that call site's own doc comment.
 *
 * Pure counting, so it's testable without a browser, a session or Firestore:
 * the page owns what to do with the count, this owns storing it.
 */
import { browserStorage as storage } from "./browser-storage";

export const INTERACTIONS_KEY = "intervu.jobs.onboarding.interactions";

/* ------------------------------------------------------------------ *
 * Browser storage. Same defensive idiom as `auth/guest-save-gate.ts`:
 * every access is null-guarded and try/caught, because localStorage is
 * absent during SSR and THROWS (not returns null) in some private modes.
 * ------------------------------------------------------------------ */

// Deliberately not exported: nothing renders the count, so the only honest
// way to read it is as the return of the increment that produced it. An
// exported getter would invite a component to hold a copy that goes stale.
function readInteractions(): number {
    const n = parseInt(storage()?.getItem(INTERACTIONS_KEY) ?? "0", 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/** Increment the interaction counter and return the new count. */
export function recordOnboardingInteraction(): number {
    const next = readInteractions() + 1;
    try {
        storage()?.setItem(INTERACTIONS_KEY, String(next));
    } catch {
        /* quota exceeded / private mode */
    }
    return next;
}

/** Read the current search-interaction count without incrementing. */
export function getOnboardingInteractionCount(): number {
    return readInteractions();
}
