/**
 * Client-safe mirror of the cost/auth gate's sentinel prefixes.
 *
 * `credit-gate.ts` defines AUTH_REQUIRED / OUT_OF_CREDITS / BYOK_REQUIRED but imports
 * firebase-admin, so it can't be pulled into client components. Server actions
 * throw errors prefixed with these tokens (e.g. "AUTH_REQUIRED: Sign in …");
 * the UI uses the helpers here to branch — open the login popover for
 * AUTH_REQUIRED, show an add-key message for BYOK_REQUIRED / OUT_OF_CREDITS —
 * instead of dumping a raw error string at the user.
 *
 * Keep these literals in sync with src/lib/llm/credit-gate.ts.
 */

export const AUTH_REQUIRED = "AUTH_REQUIRED";
export const OUT_OF_CREDITS = "OUT_OF_CREDITS";
export const BYOK_REQUIRED = "BYOK_REQUIRED";

export type SentinelKind = "auth" | "credits" | "byok" | null;

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

/** Classify an error/message as an auth or out-of-credits sentinel, else null. */
export function classifySentinel(e: unknown): SentinelKind {
    const msg = messageOf(e);
    if (msg.startsWith(AUTH_REQUIRED)) return "auth";
    if (msg.startsWith(BYOK_REQUIRED)) return "byok";
    if (msg.startsWith(OUT_OF_CREDITS)) return "credits";
    return null;
}

/**
 * Strip the leading "SENTINEL: " prefix so the human-readable remainder can be
 * shown to the user. Falls back to the whole message if there's no prefix.
 */
export function sentinelMessage(e: unknown): string {
    const msg = messageOf(e);
    const idx = msg.indexOf(":");
    if (idx !== -1 && (msg.startsWith(AUTH_REQUIRED) || msg.startsWith(OUT_OF_CREDITS) || msg.startsWith(BYOK_REQUIRED))) {
        return msg.slice(idx + 1).trim();
    }
    return msg;
}
