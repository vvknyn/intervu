import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { signOutBrowserLocation, signOutRedirectTarget, workOsLogoutSessionId } from "@/lib/auth/signout-request";

/**
 * WorkOS AuthKit sign-out route.
 * POST only — sign-out mutates state so it must never be a GET handler.
 *
 * AuthKit's signOut() deletes cookies then redirect()s (307). We catch that
 * redirect, revoke the WorkOS session server-side when needed, and 303 the
 * browser to a same-origin path — never to api.workos.com's logout page.
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
                const sessionId = workOsLogoutSessionId(location);
                if (sessionId) {
                    try {
                        await getWorkOS().userManagement.revokeSession({ sessionId });
                    } catch {
                        // Best-effort — cookie is already deleted.
                    }
                }

                // Cookie deletes from signOut() stay on this response: Next
                // merges the route cookie store onto whatever Response we
                // return (appendMutableCookies). Rethrowing would keep 307.
                const browserLocation = signOutBrowserLocation(location);
                const target = signOutRedirectTarget(browserLocation);
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
