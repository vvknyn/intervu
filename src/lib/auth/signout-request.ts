/** True only for the WorkOS sign-out POST — middleware must skip authkit here. */
export function isAuthSignOutRequest(pathname: string, method: string): boolean {
    return method.toUpperCase() === "POST" && pathname === "/auth/signout";
}

/**
 * Where the browser should go after the sign-out POST.
 * Absolute WorkOS logout URLs are followed as GET (303). A relative AuthKit
 * fallback (`/`) must stay relative — building it from the request origin is
 * forbidden for auth routes, and `NextResponse.redirect` rejects relative URLs.
 */
export function signOutRedirectTarget(location: string): { status: 303; location: string; relative: boolean } {
    if (!location || location.startsWith("//")) {
        throw new Error("Refusing sign-out redirect");
    }
    const relative = location.startsWith("/") && !location.startsWith("//");
    return { status: 303, location, relative };
}
