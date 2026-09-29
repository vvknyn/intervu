/**
 * Pure gates for /jobs chrome that must never key off stale persistence
 * without a confirmed WorkOS session (except a guest résumé kept in this browser).
 */

/** Resolved session — not "auth still loading" and not "signed out". */
export function isConfirmedSignedIn(authReady: boolean, user: unknown): boolean {
    return authReady && !!user;
}

export function isConfirmedSignedOut(authReady: boolean, user: unknown): boolean {
    return authReady && !user;
}

/**
 * Tri-state résumé presence for chrome. A signed-out visitor's résumé counts
 * when it is the guest résumé kept in this browser (parsing on device is open
 * to everyone); session-local résumé state from a prior account is not, so it
 * must not unlock For you after sign-out.
 */
export function resolveJobsResumeOnFile(input: {
    authReady: boolean;
    signedIn: boolean;
    hasUsableResume: boolean;
    guestResumeInBrowser: boolean;
    resumeKnownOnServer: boolean | null;
}): boolean | null {
    const localGuestResume = !input.signedIn && input.guestResumeInBrowser && input.hasUsableResume;
    if (localGuestResume || (input.signedIn && input.hasUsableResume)) return true;
    if (!input.authReady) return null;
    return input.signedIn ? input.resumeKnownOnServer : false;
}

/**
 * Header-row For you ⇄ Search switch. A confirmed signed-in session always
 * gets it, including when no résumé is on file yet. Signed-out sessions,
 * and auth that has not resolved, never see it.
 */
export function shouldShowJobsHomeViewToggle(input: {
    signedOut: boolean;
    signedIn: boolean;
    resumeOnFile: boolean | null;
    showJobsHomePending: boolean;
}): boolean {
    if (input.signedOut || !input.signedIn) return false;
    return true;
}
