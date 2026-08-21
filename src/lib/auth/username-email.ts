/**
 * Username → login address, and the inverse question no caller could ask
 * before: did WE mint this address, or did the user actually give it to us?
 *
 * `signUp` (actions/auth.ts) registers password accounts under a SYNTHESIZED
 * address — `<username>@intervu.cc` — because Firebase Auth requires an
 * email identifier and this product's password flow asks only for a
 * username. Nobody reads that mailbox; it is an identifier wearing an
 * address's shape. Anything that tries to REACH a user (E1's `sendEmail`
 * and everything built on it) therefore has to tell the two apart, or it
 * hard-bounces every password account — and a bounce rate like that costs
 * the sending domain's reputation for every later send, the digest
 * included.
 *
 * The template lived in three places (actions/auth.ts's own
 * `getEmailFromUsername`, plus two inline copies in
 * lib/firebase/client-auth.ts) before this module. Both halves live here
 * now for one reason: a detector that can drift from the minter is a
 * detector that eventually says "real address" about something we made up.
 * Change the domain and both move together, by construction.
 */
import { z } from "zod";
import { normalizeEmail } from "@/lib/email/normalize-email";

/** The domain password signups are registered under. Not a mail domain we
 *  deliver to — see this module's header. */
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

const signupEmailSchema = z.string().trim().toLowerCase().email();

export type SignupEmailResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * The signup-email decision, pulled out of `signUp` (actions/auth.ts) as a
 * pure function: format-valid, and not one of our own minted addresses
 * (`isMintedLoginEmail`, above — never a literal domain compare, so a future
 * domain change stays covered by construction). `signUp` is a "use server"
 * file, which Next.js requires to export only async actions, so this can't
 * live there — and keeping it here, beside the predicate it depends on,
 * means the minter/detector/validator can't drift apart into three answers
 * to "is this address usable." Runs before any I/O (rate limiting,
 * Turnstile, Firebase Admin), so it's unit-testable without mocking any of
 * that, and callers fail fast on the cheap check first.
 */
export function validateSignupEmail(raw: unknown): SignupEmailResult {
    const parsed = signupEmailSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: "Enter a valid email address" };
    }
    if (isMintedLoginEmail(parsed.data)) {
        return { ok: false, error: "That email can't be used to sign up" };
    }
    return { ok: true, email: parsed.data };
}
