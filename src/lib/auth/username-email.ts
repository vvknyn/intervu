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

/**
 * True when a typed login identifier is a real email rather than a bare
 * username — the shape decides, not an enumerated list of who is legacy.
 * Relocated from lib/firebase/client-auth.ts (2026-08-27 WorkOS migration):
 * the routing decision it feeds, `resolveLoginEmail` below, now runs
 * server-side inside the password sign-in action rather than client-side, so
 * it belongs beside `usernameEmail` rather than in a Firebase-specific file.
 */
export function isEmailIdentifier(identifier: string): boolean {
    return identifier.trim().includes("@");
}

/**
 * The single "what address does this login attempt mean" decision. An email
 * identifier is used as-is; a bare username re-derives the synthesized
 * `<username>@intervu.cc` address (legacy accounts predating the 2026-08-20
 * signup-ladder audit — see `usernameEmail`'s doc). One chokepoint so the
 * password sign-in action can't drift from what `usernameEmail`/
 * `isEmailIdentifier` each mean on their own.
 */
export function resolveLoginEmail(identifier: string): string {
    const trimmed = identifier.trim();
    return isEmailIdentifier(trimmed) ? trimmed : usernameEmail(trimmed);
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
