/** True only for the WorkOS sign-out POST — middleware must skip authkit here. */
export function isAuthSignOutRequest(pathname: string, method: string): boolean {
    return method.toUpperCase() === "POST" && pathname === "/auth/signout";
}

/** True for an absolute WorkOS logout URL the browser must not render. */
export function isWorkOsLogoutUrl(location: string): boolean {
    if (!location || location.startsWith("//")) return false;
    try {
        const url = new URL(location);
        return (
            url.protocol === "https:" &&
            url.hostname === "api.workos.com" &&
            url.pathname.includes("/sessions/logout")
        );
    } catch {
        return false;
    }
}

/** Returns WorkOS session id when `location` is an absolute WorkOS logout URL. */
export function workOsLogoutSessionId(location: string): string | null {
    if (!isWorkOsLogoutUrl(location)) return null;
    return new URL(location).searchParams.get("session_id") || null;
}

/** Browser Location after sign-out — never forwards the WorkOS logout interstitial URL. */
export function signOutBrowserLocation(location: string): string {
    if (isWorkOsLogoutUrl(location)) return "/";
    return signOutRedirectTarget(location).location;
}

/**
 * Where the browser should go after the sign-out POST.
 * A relative AuthKit fallback (`/`) must stay relative — building it from the
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
