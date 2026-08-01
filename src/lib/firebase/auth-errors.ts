/**
 * Map any auth failure to copy a person can act on. Firebase surfaces raw
 * strings like "Firebase: Error (auth/operation-not-allowed)." — those must
 * never reach the UI. App-thrown messages (no "Firebase:" prefix, e.g.
 * "Username is already taken") pass through untouched.
 */
const AUTH_CODE_COPY: Record<string, string> = {
    "auth/invalid-credential": "Invalid username or password",
    "auth/wrong-password": "Invalid username or password",
    "auth/user-not-found": "Invalid username or password",
    "auth/operation-not-allowed": "That sign-in method isn't enabled right now.",
    "auth/too-many-requests": "Too many attempts — wait a minute and try again.",
    "auth/network-request-failed": "Network hiccup — check your connection and try again.",
    "auth/email-already-in-use": "That email is already registered — try logging in instead.",
    "auth/weak-password": "Password is too weak — use at least 6 characters.",
};

export function friendlyAuthMessage(err: unknown, fallback: string): string {
    const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const code = raw.match(/auth\/[a-z-]+/)?.[0];
    if (code && AUTH_CODE_COPY[code]) return AUTH_CODE_COPY[code];
    if (!raw || raw.includes("Firebase:") || code) return fallback;
    return raw;
}
