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
 * `AuthenticationException` covers every WorkOS-flagged auth condition that
 * isn't a plain wrong password (email_verification_required, MFA, radar
 * challenges, ...) — spec decision §2: this app requires no verification
 * today, so all of those collapse to the same generic fallback rather than
 * telling someone to "verify your email" for a requirement that doesn't
 * exist.
 */
export function friendlyWorkosAuthMessage(err: unknown, fallback: string): string {
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { status?: number } | null)?.status;

  if (name === "UnauthorizedException" || status === 401) {
    return "Invalid email or password";
  }
  if (name === "RateLimitExceededException" || status === 429) {
    return "Too many attempts — wait a minute and try again.";
  }
  if (name === "ConflictException" || status === 409) {
    return "That email is already registered — try logging in instead.";
  }
  // AuthenticationException, BadRequestException, UnprocessableEntityException,
  // NotFoundException, and anything unrecognized: no raw SDK message ever
  // reaches the UI, so these all take the caller's own fallback copy.
  return fallback;
}
