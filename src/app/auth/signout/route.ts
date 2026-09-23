import { signOut } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { signOutRedirectTarget } from "@/lib/auth/signout-request";

/**
 * WorkOS AuthKit sign-out route.
 * POST only — sign-out mutates state so it must never be a GET handler.
 *
 * AuthKit's signOut() deletes cookies then redirect()s (307). A followed 307
 * from a POST would hit WorkOS logout with POST; we convert to 303 so the
 * browser GETs the logout URL and revokes the refresh token.
 */
function redirectLocationFromDigest(digest: string): string | null {
    if (!digest.startsWith("NEXT_REDIRECT;")) return null;
    const parts = digest.split(";");
    const location = parts.slice(2, -2).join(";");
    return location || null;
}

export async function POST() {
    try {
        return await signOut();
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "digest" in error &&
            typeof (error as { digest: unknown }).digest === "string"
        ) {
            const location = redirectLocationFromDigest((error as { digest: string }).digest);
            if (location) {
                // Cookie deletes from signOut() stay on this response: Next
                // merges the route cookie store onto whatever Response we
                // return (appendMutableCookies). Rethrowing would keep 307.
                const target = signOutRedirectTarget(location);
                if (target.relative) {
                    return new NextResponse(null, {
                        status: target.status,
                        headers: { Location: target.location },
                    });
                }
                return NextResponse.redirect(target.location, target.status);
            }
        }
        throw error;
    }
}
