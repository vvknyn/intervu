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
 * Why /jobs holds its place instead of painting the Search home at rest, or
 * `null` when it paints the home:
 * - "resume": signed in, résumé presence not known yet.
 * - "fit": signed in with a résumé on file, and the résumé-ranked list the
 *   page opens on is still being fetched. Until it lands the front door (an
 *   upload prompt and a signed-out masthead) is a wrong frame for this person,
 *   so a neutral list column holds the place.
 * Both end after a few seconds at most (`pendingExpired`), and "fit" ends when
 * the auto-fit settles, found a résumé or not.
 */
export function jobsHomeHold(input: {
    signedIn: boolean;
    atRest: boolean;
    searchIntent: boolean;
    resumeOnFile: boolean | null;
    /** Nothing the visitor chose (filter, sort, submit) or applied (fit) stands in the way of the auto-fit. */
    autoFitEligible: boolean;
    autoFitSettled: boolean;
    pendingExpired: boolean;
}): "resume" | "fit" | null {
    if (!input.signedIn || !input.atRest || input.searchIntent || input.pendingExpired) return null;
    if (input.resumeOnFile === null) return "resume";
    return input.resumeOnFile && input.autoFitEligible && !input.autoFitSettled ? "fit" : null;
}
