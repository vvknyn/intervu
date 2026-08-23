/**
 * Map any auth failure to copy a person can act on. Supabase's `AuthError`
 * carries a stable `.code` (e.g. "invalid_credentials") distinct from its
 * `.message` — unlike Firebase, which smashed its code into the message
 * string ("Firebase: Error (auth/wrong-password)."), so there is no message
 * to raw-parse here; a thrown error's `.message` is either already
 * presentable or gets swapped for `fallback`.
 */
const AUTH_CODE_COPY: Record<string, string> = {
    invalid_credentials: "Invalid username or password",
    user_not_found: "Invalid username or password",
    email_not_confirmed: "Confirm your email before signing in.",
    over_request_rate_limit: "Too many attempts — wait a minute and try again.",
    over_email_send_rate_limit: "Too many attempts — wait a minute and try again.",
    user_already_exists: "That email is already registered — try logging in instead.",
    email_exists: "That email is already registered — try logging in instead.",
    weak_password: "Password is too weak — use at least 6 characters.",
    same_password: "New password must be different from your current one.",
    signup_disabled: "That sign-in method isn't enabled right now.",
    email_provider_disabled: "That sign-in method isn't enabled right now.",
    provider_disabled: "That sign-in method isn't enabled right now.",
};

export function friendlyAuthMessage(err: unknown, fallback: string): string {
    const code = (err as { code?: string } | null)?.code;
    if (code && AUTH_CODE_COPY[code]) return AUTH_CODE_COPY[code];
    if (code) return fallback;
    const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    return raw || fallback;
}
