import { NextResponse, type NextRequest } from "next/server";
import { resolvePostAuthDestination } from "@/lib/auth/post-auth-destination";
import { validateNextParam } from "@/lib/auth/product-routes";
import { withAuthProvider } from "@/lib/auth/authkit-url";

/**
 * Hand off to WorkOS AuthKit for the sign-in methods our own form cannot host.
 *
 *   /auth/start?next=/jobs                        → sign-in screen
 *   /auth/start?next=/co/acme&mode=signup         → sign-up screen; both come
 *                                                   back to `next`, where a
 *                                                   queued action (Apply) replays
 *   /auth/start?next=/jobs&provider=GoogleOAuth   → straight to that provider
 *
 * Passkeys are the reason this exists. WebAuthn needs challenge issuance,
 * credential creation/assertion and origin binding, and WorkOS does not expose
 * those as API calls — the SDK carries only passkey *event* types for webhooks.
 * AuthKit's hosted page performs the ceremony, so reaching it is the only way
 * passkeys can work at all. Magic auth rides along for free, since the hosted
 * page renders whichever methods are enabled for that WorkOS environment.
 *
 * A route handler rather than a page: `getSignInUrl` sets the PKCE cookie, and
 * a Server Component cannot set cookies while rendering.
 *
 * Deliberately an ADDITIONAL door, not a replacement one. Every existing
 * intervu account arrived through Google, and that flow keeps running through
 * the form untouched — nothing here changes how those users sign in.
 */
export async function GET(request: NextRequest) {
    // Loaded on use: @workos-inc/authkit-nextjs is ESM-only, and a static
    // import of it here would break the CJS test runner for every file that
    // transitively reaches this route.
    const { getSignInUrl, getSignUpUrl } = await import("@workos-inc/authkit-nextjs");

    const params = request.nextUrl.searchParams;
    // Validated, never passed through raw: an unchecked `next` is an open
    // redirect, and this one survives a round trip through an external host.
    const validatedNext = validateNextParam(params.get("next"));
    // Sign-up and sign-in alike come back to the page they started on.
    const returnTo = resolvePostAuthDestination(validatedNext);

    const url =
        params.get("mode") === "signup"
            ? await getSignUpUrl({ returnTo })
            : await getSignInUrl({ returnTo });

    // Both helpers above set the PKCE cookie that the callback checks `state`
    // against, so the URL must be taken from them and only re-pointed — never
    // rebuilt. Without `provider` the user lands on AuthKit's hosted page and
    // chooses there; with it they go straight to that provider's own screen.
    return NextResponse.redirect(withAuthProvider(url, params.get("provider")));
}
