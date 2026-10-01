/**
 * The one password rule this app checks itself, before WorkOS sees anything.
 *
 * WorkOS applies its own policy on `createUser` and `resetPassword`: a minimum
 * length, a strength score, and a breached-password check, configured in the
 * WorkOS dashboard rather than in this repo. The signup form used to promise
 * "6+ characters" (Firebase's old floor), so people typed passwords WorkOS
 * then refused, and the refusal surfaced as "Failed to create account" with no
 * hint why (2026-10-01 replay: seven presses, then "Too many attempts").
 *
 * Length is the only part of that policy that can be checked honestly here,
 * so it is checked before any network call, with the same number the form's
 * hint shows. Strength and breach checks stay with WorkOS; its refusal is
 * mapped to plain copy in `workos-errors.ts`.
 *
 * Sign-in deliberately does NOT use this: accounts created under older, looser
 * rules must still be able to sign in.
 */

export const MIN_PASSWORD_LENGTH = 10;

/** Shown under the password field wherever a new password is chosen. */
export const NEW_PASSWORD_HINT = `${MIN_PASSWORD_LENGTH}+ characters, not a common or reused password.`;

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;

/** Pure: the problem with a new password this app can see locally, or null. */
export function newPasswordProblem(password: string): string | null {
    return password.length < MIN_PASSWORD_LENGTH ? PASSWORD_TOO_SHORT_MESSAGE : null;
}
