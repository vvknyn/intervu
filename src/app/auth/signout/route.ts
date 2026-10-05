import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs";
import { after, NextResponse } from "next/server";
import {
    SIGN_OUT_LANDING_PATH,
    signOutBrowserLocation,
    signOutRedirectTarget,
    workOsLogoutSessionId,
} from "@/lib/auth/signout-request";
import { reportAuthStep } from "@/lib/auth/auth-timing";
import { logServer } from "@/lib/observability/posthog-logs";

/**
 * WorkOS AuthKit sign-out route.
 * POST only — sign-out mutates state so it must never be a GET handler.
 *
 * AuthKit's signOut() deletes cookies then redirect()s (307). We catch that
 * redirect and 303 the browser straight to /jobs — never to api.workos.com's
 * logout page, and not to "/", which only redirects to /jobs again.
 *
 * The WorkOS session is revoked after the response, in `after()`. The cookie
 * is already gone, so the browser is signed out whatever WorkOS answers, and
 * its API retries with backoff under a 60 s timeout: awaited, it held every
 * sign-out on a call across the Atlantic (one recorded sign-out sat 5 s
 * between the click and the page leaving, 2026-09-23).
 */
function redirectLocationFromDigest(digest: string): string | null {
    if (!digest.startsWith("NEXT_REDIRECT;")) return null;
    const parts = digest.split(";");
    const location = parts.slice(2, -2).join(";");
    return location || null;
}

async function revokeWorkOsSession(sessionId: string): Promise<void> {
    const started = Date.now();
    try {
        await getWorkOS().userManagement.revokeSession({ sessionId });
    } catch (error) {
        // Best-effort — the cookie is already deleted. Why, never the id.
        const e = error as { name?: string; status?: number } | null;
        logServer("warn", "sign-out revoke failed", {
            error_name: e?.name ?? "unknown",
            error_status: e?.status,
            duration_ms: Date.now() - started,
        });
        return;
    }
    reportAuthStep("sign_out_revoke", Date.now() - started);
}

export async function POST() {
    const started = Date.now();
    try {
        return await signOut({ returnTo: SIGN_OUT_LANDING_PATH });
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
                if (sessionId) after(() => revokeWorkOsSession(sessionId));

                // Cookie deletes from signOut() stay on this response: Next
                // merges the route cookie store onto whatever Response we
                // return (appendMutableCookies). Rethrowing would keep 307.
                const browserLocation = signOutBrowserLocation(location);
                const target = signOutRedirectTarget(browserLocation);
                reportAuthStep("sign_out", Date.now() - started, { had_session: sessionId !== null });
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
