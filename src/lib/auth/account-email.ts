/**
 * The "attach a real address to this account" decision, kept out of the
 * server action so it can be unit-tested without Firebase Admin, a request
 * scope, or a mail provider.
 *
 * Why this flow exists at all: password signups before 2026-08-20 were
 * registered under a synthesized `<username>@intervu.cc` address
 * (`username-email.ts`). Those accounts are signed in, have a truthy
 * `user.email`, and are unreachable — `send.ts` drops every send to them as
 * `no-mailbox`. Until now nothing in the product could change that:
 * `actions/account.ts` only ever READ the address.
 */
import { isMintedLoginEmail, validateSignupEmail } from "./username-email";
import { normalizeEmail } from "@/lib/email/normalize-email";

export type AccountEmailRequest =
    | { ok: true; email: string }
    | { ok: false; error: string };

/**
 * Validates an address a signed-in user typed in order to receive alerts.
 *
 * Reuses `validateSignupEmail` rather than restating the rules: format, and
 * "not one of our own minted addresses". The one rule added here is that
 * re-submitting the address the account ALREADY has is not an error worth
 * sending a confirmation email for — it's a no-op the caller should report
 * as already-done, or we'd mail someone to confirm what is already true.
 */
export function resolveAccountEmailRequest(
    raw: unknown,
    currentEmail: string | null | undefined,
): AccountEmailRequest | { ok: false; error: string; alreadySet: true } {
    const validated = validateSignupEmail(raw);
    if (!validated.ok) return validated;

    // `isMintedLoginEmail` on the CURRENT address, not a truthiness check:
    // the whole population this serves has a non-empty current address that
    // happens to be undeliverable, and comparing against it blindly would
    // let a minted address count as "already set".
    if (
        currentEmail &&
        !isMintedLoginEmail(currentEmail) &&
        normalizeEmail(currentEmail) === validated.email
    ) {
        return {
            ok: false,
            alreadySet: true,
            error: "That's already the email on your account.",
        };
    }

    return validated;
}

/**
 * What the UI should say and offer, derived from the account's state alone.
 *
 * `reachable` is the only input that decides whether alerts can work at all;
 * `pendingEmail` is an address that has been submitted but not yet confirmed,
 * which must NOT read as success — that's the same "truthy means done" trap
 * that produced the bug this whole change fixes.
 */
export type EmailNudgeState = "reachable" | "needs-email" | "pending-confirmation";

export function resolveEmailNudgeState(input: {
    reachable: boolean;
    pendingEmail: string | null;
}): EmailNudgeState {
    if (input.reachable) return "reachable";
    return input.pendingEmail ? "pending-confirmation" : "needs-email";
}
