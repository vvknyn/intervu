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
import { normalizeEmail } from "@/lib/email/normalize-email";
import { isMintedLoginEmail, usernameEmail } from "./minted-email";
import { screenSignupEmail, emailDomain, EMAIL_QUALITY_MESSAGES } from "@/lib/auth/email-quality";

// The address-shape half lives in minted-email.ts so a client component can
// ask it without pulling in email-quality's DNS lookups (node:dns/promises),
// which a browser bundle can't hold: `next dev` failed every page when the
// setup sheet imported isMintedLoginEmail from here (2026-10-05).
export { USERNAME_EMAIL_DOMAIN, usernameEmail, isMintedLoginEmail, isReachableEmail } from "./minted-email";

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

export type SignupEmailResult =
    | { ok: true; email: string }
    | { ok: false; error: string; reason?: "syntax" | "disposable"; domain?: string | null };

/**
 * The signup-email decision, pulled out of `signUp` (actions/auth.ts) as a
 * pure function: well-formed and not disposable (`screenSignupEmail`,
 * email-quality.ts), and not one of our own minted addresses
 * (`isMintedLoginEmail`, above — never a literal domain compare, so a future
 * domain change stays covered by construction). `signUp` is a "use server"
 * file, which Next.js requires to export only async actions, so this can't
 * live there — and keeping it here, beside the predicate it depends on,
 * means the minter/detector/validator can't drift apart into three answers
 * to "is this address usable." Runs before any I/O (rate limiting,
 * Turnstile, Firebase Admin), so it's unit-testable without mocking any of
 * that, and callers fail fast on the cheap check first.
 *
 * `reason`/`domain` are populated only for the two `screenSignupEmail`
 * outcomes — the anti-self-mint rejection is a separate, unrelated concern
 * and callers should not conflate it with an email-quality telemetry event.
 */
export function validateSignupEmail(raw: unknown): SignupEmailResult {
    if (typeof raw !== "string") {
        return { ok: false, error: EMAIL_QUALITY_MESSAGES.syntax, reason: "syntax", domain: null };
    }
    const email = normalizeEmail(raw);
    const screenResult = screenSignupEmail(email);
    if (screenResult) {
        return { ok: false, error: EMAIL_QUALITY_MESSAGES[screenResult], reason: screenResult, domain: emailDomain(email) };
    }
    if (isMintedLoginEmail(email)) {
        return { ok: false, error: "That email can't be used to sign up" };
    }
    return { ok: true, email };
}
