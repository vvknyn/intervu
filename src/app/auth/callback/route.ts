import { handleAuth } from "@workos-inc/authkit-nextjs";
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { getSiteUrl } from "@/lib/seo/constants";
import { provisionAppAccess, realProvisioningDeps } from "@/lib/auth/provisioning";
import { withDirectHitGuard } from "@/lib/auth/callback-guard";
import type { SignupMethod } from "@/lib/analytics/event-names";
import { attachSignupSignalCookie, resolveAuthKitSignupSignal } from "@/lib/auth/authkit-signup-signal";

/**
 * WorkOS AuthKit OAuth callback route.
 * Exchanges the authorization code for a session and sets cookies.
 *
 * `baseURL` is not optional here, whatever the library's default suggests.
 * Without it the post-exchange redirect is built from the inbound request
 * (`authkit-callback-route.ts`: `baseURL ? new URL(baseURL) : new URL(requestUrl)`),
 * and this app is served by Caddy in front of a container that binds `0.0.0.0`
 * — so the browser was sent to `0.0.0.0` immediately after choosing a Google
 * account. Everything upstream looked healthy because the authorization
 * `redirect_uri` comes from an absolute env var; only this last hop read the
 * request's own host.
 *
 * `getSiteUrl()` is the same canonical origin `metadataBase`, the sitemap and
 * robots.txt already use, and it throws when unset rather than guessing a
 * domain — so a missing var fails loudly at startup instead of silently
 * redirecting users somewhere unreachable.
 *
 * `onSuccess` is this route's provisioning hook — the class fix for spec §4.
 * Google/passkey/magic-auth sign-in never touches `actions/auth.ts`'s
 * `signIn`/`signUp`, so without a hook here those users got no welcome email
 * and no "Intervu" org membership. Deferred via `after()`,
 * same reasoning as `signIn`/`signUp`'s own provisioning calls: it must never
 * turn a successful WorkOS exchange into a redirect error, and a person
 * finishing sign-in should not wait on Resend or Firestore to land on the app.
 *
 * `authenticationMethod` comes straight off the session WorkOS just handed
 * back (`"GoogleOAuth"`, `"Passkey"`, `"MagicAuth"`, ...) — free to read, so
 * `provisionAppAccess`'s telemetry gets the real method instead of a
 * one-size-fits-all `"oauth"` that would mislabel a passkey or magic-link
 * sign-in. It's typed optional upstream; `"ExternalAuth"` (WorkOS's own
 * catch-all member of the same union) covers the rare case it's absent
 * rather than inventing a new label.
 *
 * AuthKit signups emit `signup_completed` via a short-lived
 * `intervu_signup_completed` cookie set here and consumed client-side in
 * `PostHogProvider` after `posthog.identify(uid)`. The signal is
 * `!hasApp(metadata.apps, intervu)` evaluated BEFORE `provisionAppAccess`
 * tags them — not `user.createdAt ≈ now`. Username/password signups never hit
 * this route; they fire from `login-form.tsx` directly.
 *
 * `withDirectHitGuard` (src/lib/auth/callback-guard.ts) redirects a request
 * that carries neither `code` nor `error` straight to /login instead of
 * letting it fall into handleAuth's generic 500 — see that file for why.
 */
export const GET = withDirectHitGuard(async (request: NextRequest) => {
    let signal: SignupMethod | null = null;
    const workos = handleAuth({
        baseURL: getSiteUrl(),
        onSuccess: async ({ user, authenticationMethod }) => {
            signal = resolveAuthKitSignupSignal({
                apps: user.metadata?.apps,
                authenticationMethod: authenticationMethod ?? "ExternalAuth",
            });
            after(() =>
                realProvisioningDeps()
                    .then((deps) => provisionAppAccess(deps, user, authenticationMethod ?? "ExternalAuth"))
                    .catch((err) => console.error("[Auth] callback provisioning failed:", err)),
            );
        },
    });
    const response = await workos(request);
    return attachSignupSignalCookie(response, signal);
});
