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
