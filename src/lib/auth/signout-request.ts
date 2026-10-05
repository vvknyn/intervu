/** True only for the WorkOS sign-out POST — middleware must skip authkit here. */
export function isAuthSignOutRequest(pathname: string, method: string): boolean {
    return method.toUpperCase() === "POST" && pathname === "/auth/signout";
}

/**
 * True for an absolute WorkOS logout URL the browser must not render: on
 * api.workos.com, or on the API host this server is pointed at
 * (`WORKOS_API_HOSTNAME`, which the SDK builds the logout URL from). Missing
 * the second, a local WorkOS stand-in sent the browser to its logout page and
 * never exercised the revoke path production takes.
 */
export function isWorkOsLogoutUrl(
    location: string,
    apiHostname: string | undefined = process.env.WORKOS_API_HOSTNAME,
): boolean {
    if (!location || location.startsWith("//")) return false;
    try {
        const url = new URL(location);
        const onWorkOs = url.protocol === "https:" && url.hostname === "api.workos.com";
        const onConfiguredHost =
            !!apiHostname && url.hostname === apiHostname && (url.protocol === "https:" || url.protocol === "http:");
        return (onWorkOs || onConfiguredHost) && url.pathname.includes("/sessions/logout");
    } catch {
        return false;
    }
}

/** Returns WorkOS session id when `location` is an absolute WorkOS logout URL. */
export function workOsLogoutSessionId(location: string): string | null {
    if (!isWorkOsLogoutUrl(location)) return null;
    return new URL(location).searchParams.get("session_id") || null;
}

/**
 * Where a signed-out browser lands: the job board itself. "/" only redirects
 * here again, which cost every sign-out a second round trip.
 */
export const SIGN_OUT_LANDING_PATH = "/jobs";

/** Browser Location after sign-out — never forwards the WorkOS logout interstitial URL. */
export function signOutBrowserLocation(location: string): string {
    if (isWorkOsLogoutUrl(location) || location === "/") return SIGN_OUT_LANDING_PATH;
    return signOutRedirectTarget(location).location;
}

/**
 * Where the browser should go after the sign-out POST.
 * A relative AuthKit fallback (`/jobs`) must stay relative — building it from the
 * request origin is forbidden for auth routes, and `NextResponse.redirect`
 * rejects relative URLs.
 */
export function signOutRedirectTarget(location: string): { status: 303; location: string; relative: boolean } {
    if (!location || location.startsWith("//")) {
        throw new Error("Refusing sign-out redirect");
    }
    const relative = location.startsWith("/") && !location.startsWith("//");
    return { status: 303, location, relative };
}
