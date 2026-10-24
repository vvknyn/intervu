import { minutesLabel } from "@/lib/shield/rate-limit";

/**
 * What the one-shot email form (the /connect and /openclaw waitlist) says when they refuse. Their own module
 * because a "use server" file may export only async functions. Same rule as
 * the signup refusals (lib/auth/auth-refusal-copy.ts): every line says what
 * happened and what to do next, and names a way in the refusal doesn't cover
 * (the support address, which no per-IP limit touches).
 */

/** A malformed email: the browser's own check lets through "name@host" with no dot, the server's doesn't. */
export const EMAIL_FORM_INVALID_MESSAGE = "Enter a full email address, like you@example.com.";

/** Pure: the per-IP refusal — what happened, how long to wait, and `otherWay` (a sentence ending in a full stop). */
export function emailFormRateLimitMessage(retryAfterMs: number, otherWay: string): string {
    return `Too many tries from your network just now. Try again in ${minutesLabel(retryAfterMs)}, or ${otherWay}`;
}
