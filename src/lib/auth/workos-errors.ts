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
 * challenges, ...) — spec decision §2: this app requires no verification
 * today, so all of those collapse to the same generic fallback rather than
 * telling someone to "verify your email" for a requirement that doesn't
 * exist.
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
