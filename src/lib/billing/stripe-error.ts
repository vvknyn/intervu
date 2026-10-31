/**
 * Stripe failures for the server log. Never shown to a user: the page says one generic line.
 */

const KEY = /\b(?:rk|sk|pk)_(?:live|test)_[\w*]+/g;
/** Customer, account, charge and similar object ids: the log keeps counts and classes, never an id. */
const OBJECT_ID = /\b(?:cus|acct|pi|ch|in|sub|cs|re|dp|du|evt|si|il|pm|card|src)_[A-Za-z0-9_]{6,}/g;

/** A Stripe refusal for the key itself (HTTP 403): a restricted key missing a permission. */
export function isPermissionDenied(error: unknown): boolean {
    return error instanceof Error && (error as { type?: unknown }).type === "StripePermissionError";
}

/** One log line: error class, code, status and message, with any API key or object id blanked. The message names a missing permission. */
export function describeStripeError(error: unknown): string {
    if (!(error instanceof Error)) return "unknown error";
    const e = error as Error & { type?: unknown; code?: unknown; statusCode?: unknown };
    const parts = [typeof e.type === "string" ? e.type : e.name];
    if (typeof e.code === "string") parts.push(`code=${e.code}`);
    if (typeof e.statusCode === "number") parts.push(`status=${e.statusCode}`);
    return `${parts.join(" ")}: ${e.message.replace(KEY, "[key]").replace(OBJECT_ID, "[id]").slice(0, 400)}`;
}
