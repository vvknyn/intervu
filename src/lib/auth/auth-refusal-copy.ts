import { minutesLabel } from "@/lib/shield/rate-limit";

/**
 * What the password signup and sign-in actions (actions/auth.ts) say when
 * they refuse. Its own module because a "use server" file may export only
 * async functions. Every line says what happened and what to do next, and
 * names the ways in that this refusal does not cover: Google and the
 * passkey/email-code button both go through WorkOS AuthKit, which none of
 * these per-IP limits touch.
 */

/** The fallback when WorkOS refuses an account for a reason with no copy of its own. Points at the two ways in that skip this form. */
export const SIGNUP_FAILED_MESSAGE =
    "We couldn't create your account. Try again, or use Continue with Google or the email code above.";

/** Pure: what a per-IP signup refusal says — what happened, how long, and the ways in it doesn't cover. */
export function signupRateLimitMessage(retryAfterMs: number): string {
    return `Too many sign-up tries from your network just now. Try again in ${minutesLabel(retryAfterMs)}, or use Continue with Google or the email code above.`;
}

/** Pure: the sign-in equivalent. */
export function signInRateLimitMessage(retryAfterMs: number): string {
    return `Too many sign-in tries from your network just now. Try again in ${minutesLabel(retryAfterMs)}, or use Continue with Google or the email code above.`;
}
