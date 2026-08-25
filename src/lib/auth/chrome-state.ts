/**
 * Which auth affordance the app chrome should paint.
 *
 * The bug this exists to make impossible: `null` was doing double duty in
 * TopBar — it meant BOTH "signed out" and "we haven't asked yet". Those are
 * different answers. `onAuthChange` (lib/firebase/client-auth.ts) is async by
 * design: when Firebase's cache reports nobody that is not yet an answer,
 * because a WorkOS session lives in an httpOnly cookie the SDK cannot see, so
 * the server is asked before anyone is told they are signed out. Chrome that
 * treats the gap as "signed out" flashes a Sign-in button at a signed-in user
 * — the exact failure client-auth.ts:250-257 was reordered to prevent.
 *
 * Pure decision, no I/O, so the three-way is unit-testable without a renderer
 * — same split as `checkRateLimitWindow` (lib/shield/rate-limit.ts) and
 * `resolveDegradedServe` (lib/jobs/search-cache.ts).
 */

export type AuthChromeState =
  /** Auth has not resolved. Paint neutral chrome — assert nothing either way. */
  | "pending"
  /** A user is signed in, via either provider. */
  | "authenticated"
  /** Resolved, and nobody is signed in. */
  | "anonymous";

/**
 * `undefined` means "not resolved yet"; `null` means "resolved to nobody".
 * Callers must therefore initialise their state to `undefined`, not `null` —
 * initialising to `null` claims an answer the app does not have.
 */
export function resolveAuthChrome(user: unknown): AuthChromeState {
  if (user === undefined) return "pending";
  return user ? "authenticated" : "anonymous";
}
