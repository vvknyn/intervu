import { after } from "next/server";
import { cookies } from "next/headers";
import type { AuthenticationMethod, User } from "@workos-inc/node";
import { provisionAppAccess, realProvisioningDeps } from "@/lib/auth/provisioning";
import { claimSignupEvent } from "@/lib/auth/signup-event";
import {
    mapAuthKitSignupMethod,
    SIGNUP_SIGNAL_COOKIE_NAME,
    signupSignalCookieOptions,
} from "@/lib/auth/authkit-signup-signal";

/**
 * What every AuthKit sign-in does once WorkOS has handed back a session:
 * `/auth/callback`'s `onSuccess`, and the emailed-code step
 * (`actions/auth-email-code.ts`) that finishes a Google sign-in WorkOS held
 * for verification. One function so the two can't drift: a person who had to
 * type a code still gets their welcome email, their app membership and one
 * `signup_completed`.
 *
 * Provisioning is the class fix for spec §4: Google/passkey/magic-auth
 * sign-in never touches `actions/auth.ts`'s `signIn`/`signUp`, so without this
 * those users got no welcome email and no "Intervu" org membership. Deferred
 * via `after()`, same reasoning as `signIn`/`signUp`'s own provisioning calls:
 * it must never turn a successful WorkOS exchange into an error, and a person
 * finishing sign-in should not wait on Resend or Firestore to land on the app.
 *
 * `authenticationMethod` comes straight off the session WorkOS just handed
 * back (`"GoogleOAuth"`, `"Passkey"`, `"MagicAuth"`, ...), so
 * `provisionAppAccess`'s telemetry gets the real method instead of a
 * one-size-fits-all `"oauth"`. It's typed optional upstream; `"ExternalAuth"`
 * (WorkOS's own catch-all member of the same union) covers the rare case it's
 * absent rather than inventing a new label.
 *
 * AuthKit signups emit `signup_completed` via a short-lived
 * `intervu_signup_completed` cookie set here (`cookies().set()`, the same API
 * WorkOS `saveSession` uses — wrapping a Response to append Set-Cookie would
 * risk dropping the session cookie) and consumed client-side in
 * `PostHogProvider` after `posthog.identify(uid)`. The cookie is set only when
 * `claimSignupEvent` (src/lib/auth/signup-event.ts) wins: a fresh WorkOS
 * `createdAt` plus a durable once-per-uid claim — never the `metadata.apps`
 * tag, which is only written later by the `after()` below.
 */
export async function completeAuthKitSignIn(user: User, authenticationMethod: AuthenticationMethod | undefined): Promise<void> {
    const method = mapAuthKitSignupMethod(authenticationMethod);
    if ((await claimSignupEvent(user)) && method) {
        const cookieStore = await cookies();
        cookieStore.set(SIGNUP_SIGNAL_COOKIE_NAME, method, signupSignalCookieOptions()); // signup-once: cookie only after claimSignupEvent won
    }
    after(() =>
        realProvisioningDeps()
            .then((deps) => provisionAppAccess(deps, user, authenticationMethod ?? "ExternalAuth"))
            .catch((err) => console.error("[Auth] AuthKit provisioning failed:", err)),
    );
}
