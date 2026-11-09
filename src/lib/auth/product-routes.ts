/**
 * Routes that require a signed-in session in middleware.
 * `/jobs` is intentionally public for SERP browse — detail/apply still gate in UI.
 */
/**
 * 2026-08-08 engagement wave: `/yours` and `/connect` came OFF this list.
 * Both ship deliberate guest experiences the gate made unreachable — the
 * guest pursuit tracker (localStorage-only, syncs on login) and /connect's
 * public onboarding + non-Mac waitlist capture — while everything behind
 * them that reads real account data still authenticates at the action/API
 * layer. Only surfaces that render server-side account data stay here.
 *
 * `/account` came OFF this list in the 2026-08-27 redesign: it is now a
 * one-line redirect to `/settings?tab=account` and nothing else — "one
 * door, one guard" — so `/settings` is the sole real gate and `/account`
 * carries no gate of its own to drift out of sync with it.
 */
export const AUTH_GATED_PRODUCT_PREFIXES = [
    "/settings",
] as const;

/**
 * Paths that stay public even though they fall under a gated prefix above —
 * support content must be reachable logged-out. Checked before the gated-
 * prefix match in `isAuthGatedProductPath`, so a match here always wins;
 * new exceptions are added here rather than as scattered per-caller checks.
 * (Empty since /connect was un-gated — its /connect/help entry became
 * moot — but the mechanism stays for the next gated-prefix exception.)
 */
export const PUBLIC_PRODUCT_PATH_EXCEPTIONS = [] as const;

/** Paths allowed as post-auth `next=` (includes browse `/jobs` and the OAuth
 *  consent screen — a logged-out user bounced to /login from there needs to
 *  land back on it, with its query params, to resume the approval).
 *  `/yours` and `/connect` stay listed explicitly now that they're no longer
 *  auth-gated — sign-in flows still legitimately return to both. */
export const SAFE_POST_AUTH_PREFIXES = [
    "/jobs",
    "/yours",
    "/connect",
    "/co",
    "/admin",
    "/oauth/authorize",
    ...AUTH_GATED_PRODUCT_PREFIXES,
] as const;

function pathMatchesAnyPrefix(pathname: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isAuthGatedProductPath(pathname: string): boolean {
    if (pathMatchesAnyPrefix(pathname, PUBLIC_PRODUCT_PATH_EXCEPTIONS)) return false;
    return pathMatchesAnyPrefix(pathname, AUTH_GATED_PRODUCT_PREFIXES);
}

function isSafePostAuthPath(pathname: string): boolean {
    return pathMatchesAnyPrefix(pathname, SAFE_POST_AUTH_PREFIXES);
}

/**
 * Login redirect target for a gated route hit while logged out: same
 * origin as the request, pathname forced to `/login`, `next` carrying the
 * original path + query so LoginClient's `redirectAfterAuth` can bounce
 * back after sign-in. Always same-origin and always `/login` by
 * construction — this can never resolve to the WorkOS hosted chooser
 * (skillful-spoon-89.authkit.app), unlike the authorizationUrl this
 * replaced.
 */
export function loginRedirectUrl(requestUrl: URL, pathname: string): URL {
    const url = new URL(requestUrl);
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${requestUrl.search}`);
    return url;
}

/**
 * The address a link to `href` should carry for a visitor who is not (or not yet
 * known to be) signed in. A link to a gated page answers every such visitor with
 * a redirect to `/login?next=…` (middleware.ts), so the link says that address
 * itself and the click, and any crawler reading the page, is one request. The
 * `next=` it writes is the one {@link loginRedirectUrl} writes.
 */
export function hrefForSignedOut(href: string): string {
    const path = href.split(/[?#]/)[0];
    return isAuthGatedProductPath(path) ? `/login?next=${encodeURIComponent(href)}` : href;
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
