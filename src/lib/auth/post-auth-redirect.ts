/**
 * Leaving a sign-in surface: wait for the SERVER to know you're signed in.
 *
 * Firebase's client auth-state signal resolves as soon as the credential does
 * — one network round trip before `/api/auth/session` has minted the cookie a
 * server-rendered destination reads. `/oauth/authorize` (the agent-connect
 * consent screen) is exactly such a destination: arriving early renders its
 * "Sign in to continue" card, which to someone who just signed up is
 * indistinguishable from the sign-up having failed.
 *
 * The ordering is the whole behaviour, and ordering is invisible to a
 * source-shape test and unreachable without a DOM — so the effects are
 * parameters and the ordering gets tested directly.
 */
export interface PostAuthHandoffDeps {
    /** Make the server session match the signed-in user. Must be idempotent —
     *  it is a no-op re-mint on paths that already synced, and the only sync on
     *  paths that never do (a blocked Google popup returns via redirect). */
    ensureServerSession: () => Promise<void>;
    /** Send the visitor onward. */
    leave: (destination: string) => void;
    /** Report a failed re-mint. Reporting, not swallowing — a session that
     *  can't be established is a real failure the console should carry. */
    reportError?: (error: unknown) => void;
    /** Longest anyone is held on the sign-in page waiting for the server.
     *  Bounded on purpose: `ensureServerSession` is a fetch, and an unbounded
     *  wait on it turns a slow session endpoint into a sign-in page nobody can
     *  leave — a worse failure than the early arrival this exists to prevent. */
    sessionTimeoutMs?: number;
    /** Injected so the timeout is testable without real time passing. */
    wait?: (ms: number) => Promise<void>;
}

/** Long enough for a slow session POST on a bad connection, short enough that
 *  nobody reads it as the button not having worked. */
const DEFAULT_SESSION_TIMEOUT_MS = 4_000;

/**
 * Build a one-shot handoff. Sign-in surfaces have more than one thing watching
 * for success (an auth-state effect and a form callback both fire on the same
 * sign-in), and every one of them wants to leave; the handoff itself holds
 * "we're already leaving" so no caller has to coordinate with the others.
 */
export function createPostAuthHandoff({
    ensureServerSession,
    leave,
    reportError = (error) =>
        console.error("Could not establish the session before redirecting", error),
    sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PostAuthHandoffDeps): (destination: string) => Promise<void> {
    let leaving = false;

    return async function handOff(destination: string): Promise<void> {
        if (leaving) return;
        leaving = true;

        // Both ways of not getting a session — it failed, or it never came
        // back — are reported, and neither stops the visitor leaving. A cookie
        // an earlier sync already minted is still good, and the destination is
        // the surface that can actually tell someone they're signed out;
        // stranding them here with no feedback is strictly worse.
        let settled = false;
        const session = ensureServerSession().then(
            () => {
                settled = true;
            },
            (error) => {
                settled = true;
                reportError(error);
            },
        );

        await Promise.race([session, wait(sessionTimeoutMs)]);
        if (!settled) {
            reportError(
                new Error(
                    `Server session was not ready within ${sessionTimeoutMs}ms — continuing to ${destination}`,
                ),
            );
        }

        leave(destination);
    };
}
