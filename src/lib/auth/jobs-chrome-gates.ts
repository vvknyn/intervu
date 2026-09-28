/**
 * Pure gates for /jobs chrome that must never key off stale persistence
 * without a confirmed WorkOS session (except explicit local-AI guest mode).
 */

/** Resolved session — not "auth still loading" and not "signed out". */
export function isConfirmedSignedIn(authReady: boolean, user: unknown): boolean {
    return authReady && !!user;
}

export function isConfirmedSignedOut(authReady: boolean, user: unknown): boolean {
    return authReady && !user;
}

/**
 * Tri-state résumé presence for chrome. Signed-out visitors only count a
 * local device résumé when local-AI guest mode is on; session-local résumé
 * state from a prior account must not unlock For you after sign-out.
 */
export function resolveJobsResumeOnFile(input: {
    authReady: boolean;
    signedIn: boolean;
    hasUsableResume: boolean;
    localAiGuestEnabled: boolean;
    resumeKnownOnServer: boolean | null;
}): boolean | null {
    const localGuestResume = !input.signedIn && input.localAiGuestEnabled && input.hasUsableResume;
    if (localGuestResume || (input.signedIn && input.hasUsableResume)) return true;
    if (!input.authReady) return null;
    return input.signedIn ? input.resumeKnownOnServer : false;
}

/**
 * Bottom-bar For you ⇄ Search switch. A confirmed signed-in session always
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
