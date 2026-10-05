/**
 * Whether Velai made up an account's address (`<username>@intervu.cc`, the
 * password sign-up's identifier) or the person gave it to us. Split out of
 * username-email.ts, whose sign-up checks resolve DNS, so the browser can
 * import these without bundling node:dns. username-email.ts re-exports them;
 * see its header for why both halves of the rule live together.
 */
import { normalizeEmail } from "@/lib/email/normalize-email";

/** The domain password signups are registered under. Not a mail domain we
 *  deliver to — see username-email.ts's header. */
export const USERNAME_EMAIL_DOMAIN = "intervu.cc";

export function usernameEmail(username: string): string {
    return `${username}@${USERNAME_EMAIL_DOMAIN}`;
}

/**
 * True when this address was synthesized by `usernameEmail` rather than
 * supplied by the person behind the account (Google sign-in hands us a real,
 * Google-verified address; a password signup does not).
 *
 * Deliberately a property of the ADDRESS, not of the sign-in provider: the
 * question every caller actually has is "can mail reach this human", and
 * `firebase.sign_in_provider === "password"` only answers it by proxy — it
 * would start lying the day the password flow begins collecting real
 * addresses, whereas this keeps answering correctly (a real address stops
 * matching the minted shape).
 */
export function isMintedLoginEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return normalizeEmail(email).endsWith(`@${USERNAME_EMAIL_DOMAIN}`);
}

/**
 * Can mail actually reach the human behind this account?
 *
 * The positive form of `isMintedLoginEmail`, and the question every UI
 * surface actually wants to ask. It exists because the two halves were
 * being answered differently: `send.ts` knew a minted address is a dead
 * mailbox, while `email-preferences.ts` guarded on `!user?.email` alone — and
 * a minted address is a non-empty STRING, so it sailed through. The result
 * was a settings page showing the weekly digest switched ON for accounts
 * whose every send was being dropped one layer down. Truthy is not the same
 * as reachable, and one predicate is how the two layers stop disagreeing.
 */
export function isReachableEmail(email: string | null | undefined): boolean {
    return Boolean(email) && !isMintedLoginEmail(email);
}
