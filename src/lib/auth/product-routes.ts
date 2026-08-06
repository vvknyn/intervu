/**
 * Routes that require a signed-in session in middleware.
 * `/jobs` is intentionally public for SERP browse — detail/apply still gate in UI.
 */
export const AUTH_GATED_PRODUCT_PREFIXES = [
    "/yours",
    "/connect",
    "/settings",
    "/account",
] as const;

/** Paths allowed as post-auth `next=` (includes browse `/jobs` and the OAuth
 *  consent screen — a logged-out user bounced to /login from there needs to
 *  land back on it, with its query params, to resume the approval). */
export const SAFE_POST_AUTH_PREFIXES = [
    "/jobs",
    "/oauth/authorize",
    ...AUTH_GATED_PRODUCT_PREFIXES,
] as const;

export function isAuthGatedProductPath(pathname: string): boolean {
    return AUTH_GATED_PRODUCT_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

function isSafePostAuthPath(pathname: string): boolean {
    return SAFE_POST_AUTH_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

/**
 * Safe same-origin redirect target after sign-in. Rejects protocol-relative
 * paths (`//evil`) and off-site URLs; allows product routes, `/jobs`, and `/`.
 */
export function validateNextParam(next: string | null | undefined): string | null {
    if (!next || typeof next !== "string") return null;
    const trimmed = next.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
    const pathOnly = trimmed.split("?")[0]?.split("#")[0] ?? "";
    if (pathOnly !== "/" && !isSafePostAuthPath(pathOnly)) return null;
    return trimmed;
}
