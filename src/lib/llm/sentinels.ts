/**
 * Client-safe mirror of the auth gate's sentinel prefix.
 *
 * `credit-gate.ts` defines AUTH_REQUIRED but imports firebase-admin, so it
 * can't be pulled into client components. Server actions throw errors
 * prefixed with this token (e.g. "AUTH_REQUIRED: Sign in …"); the UI uses the
 * helpers here to branch — open the login popover for AUTH_REQUIRED —
 * instead of dumping a raw error string at the user.
 *
 * Keep this literal in sync with src/lib/llm/credit-gate.ts.
 */

export const AUTH_REQUIRED = "AUTH_REQUIRED";

export type SentinelKind = "auth" | null;

/** Pull a plain message string out of whatever an action threw/returned. */
export function messageOf(e: unknown): string {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    if (e && typeof e === "object") {
        const o = e as { error?: unknown; message?: unknown };
        if (typeof o.error === "string") return o.error;
        if (typeof o.message === "string") return o.message;
    }
    return "";
}

/** Classify an error/message as an auth sentinel, else null. */
export function classifySentinel(e: unknown): SentinelKind {
    const msg = messageOf(e);
    if (msg.startsWith(AUTH_REQUIRED)) return "auth";
    return null;
}

/**
 * Strip the leading "SENTINEL: " prefix so the human-readable remainder can be
 * shown to the user. Falls back to the whole message if there's no prefix.
 */
export function sentinelMessage(e: unknown): string {
    const msg = messageOf(e);
    const idx = msg.indexOf(":");
    if (idx !== -1 && msg.startsWith(AUTH_REQUIRED)) {
        return msg.slice(idx + 1).trim();
    }
    return msg;
}
