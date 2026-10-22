/**
 * Map a WorkOS SDK failure to copy a person can act on. WorkOS raises typed
 * exception classes with a `.name` and `.status`, rather than the parsed
 * `.code` string other auth SDKs use, so this dispatches on that shape.
 *
 * Dispatches on `.name`/`.status` — the exception CLASS the SDK itself
 * assigns (`factory-iK-8FO4O.mjs`'s literal switch on HTTP status) — never on
 * a parsed message string or an app-invented enum of business cases, so a
 * WorkOS SDK upgrade that adds a new exception subclass degrades to the
 * fallback instead of leaking a raw message.
 *
 * The one exception is a 422/400: WorkOS answers a refused `createUser` or
 * `resetPassword` with a top-level `code` (e.g. `password_strength_error`)
 * plus an `errors[]` list of finer codes, and the SDK's
 * `UnprocessableEntityException` folds that list into its `message` as one
 * tab-indented code per line. `workosErrorCodes` reads those codes back out —
 * codes only, never the human text around them — so a weak password or an
 * email that already has an account says so instead of "Failed to create
 * account" (2026-10-01 replay: a visitor pressed Create account seven times
 * against that generic line before the rate limit stopped them).
 *
 * `AuthenticationException` covers every WorkOS-flagged auth condition that
 * isn't a plain wrong password (email_verification_required, MFA, radar
 * challenges, ...). The password form has a code step only for
 * email_verification_required (`emailVerificationChallenge`); the rest
 * collapse to the generic fallback here.
 * WorkOS does hold some Google sign-ins for an emailed code; /auth/callback
 * sends those to /auth/verify-email (email-code-pending.ts), not through
 * this mapping.
 */

export const WORKOS_INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
export const WORKOS_RATE_LIMITED_MESSAGE = "Too many tries in a short time. Wait a minute, then try again.";
export const WORKOS_EMAIL_TAKEN_MESSAGE =
  "That email already has an account. Sign in instead, or use Continue with Google if that's how you joined.";
export const WORKOS_WEAK_PASSWORD_MESSAGE =
  "That password is too easy to guess or has shown up in a data breach. Try a longer one, such as three or four unrelated words.";

/** Pure: every machine code a WorkOS error carries — its own `code`, `errors[].code`, and the codes the SDK folded into a 422's message. */
export function workosErrorCodes(err: unknown): string[] {
  const e = err as { code?: unknown; errors?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return [];
  const codes: string[] = [];
  if (typeof e.code === "string") codes.push(e.code);
  if (Array.isArray(e.errors)) {
    for (const item of e.errors) {
      const code = (item as { code?: unknown } | null)?.code;
      if (typeof code === "string") codes.push(code);
    }
  }
  if (typeof e.message === "string") {
    for (const line of e.message.split("\n")) {
      const match = /^\t([a-z0-9_]+)$/.exec(line);
      if (match) codes.push(match[1]);
    }
  }
  return codes;
}

/**
 * Pure: the code step WorkOS wants before it will authenticate this person,
 * or null when the failure is anything else. WorkOS answers a password
 * sign-in for an unverified address with an `AuthenticationException`
 * (`code: "email_verification_required"`) carrying the token that the emailed
 * code is later redeemed against (`authenticateWithEmailVerification`).
 */
export function emailVerificationChallenge(err: unknown): { pendingAuthenticationToken: string } | null {
  const e = err as { code?: unknown; pendingAuthenticationToken?: unknown } | null;
  if (e?.code !== "email_verification_required" || typeof e.pendingAuthenticationToken !== "string") return null;
  return { pendingAuthenticationToken: e.pendingAuthenticationToken };
}

/** WorkOS will not sign this person in until they enter the code it just emailed. */
export type VerifyStep = { verify: { pendingAuthenticationToken: string; email: string } };

/**
 * The one place a password-auth failure becomes a code step. Signup's
 * auto sign-in and a returning unverified user's sign-in both route here, so
 * neither can fall back to a message the form has no way to act on. Null for
 * every other failure; the caller words that. The error carries the pending
 * token, so callers must not log it.
 */
export function verifyStepFor(err: unknown, email: string): VerifyStep | null {
  const challenge = emailVerificationChallenge(err);
  return challenge ? { verify: { ...challenge, email } } : null;
}

export function friendlyWorkosAuthMessage(err: unknown, fallback: string): string {
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { status?: number } | null)?.status;

  if (name === "UnauthorizedException" || status === 401) {
    return WORKOS_INVALID_CREDENTIALS_MESSAGE;
  }
  if (name === "RateLimitExceededException" || status === 429) {
    return WORKOS_RATE_LIMITED_MESSAGE;
  }
  if (name === "ConflictException" || status === 409) {
    return WORKOS_EMAIL_TAKEN_MESSAGE;
  }
  if (status === 422 || status === 400 || name === "UnprocessableEntityException" || name === "BadRequestException") {
    const codes = workosErrorCodes(err);
    if (codes.some((c) => c.startsWith("password_"))) return WORKOS_WEAK_PASSWORD_MESSAGE;
    if (codes.some((c) => c === "email_not_available" || c === "user_already_exists")) return WORKOS_EMAIL_TAKEN_MESSAGE;
  }
  // AuthenticationException, NotFoundException, any other 400/422 code, and
  // anything unrecognized: no raw SDK message ever reaches the UI, so these
  // all take the caller's own fallback copy.
  return fallback;
}
