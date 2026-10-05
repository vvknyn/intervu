import { unsealData } from "iron-session";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * The secret AuthKit seals its own cookies and `state` with. Both helpers
 * below and `email-code-pending.ts` seal with it too, so there is one secret
 * the box must hold, not a second one that could be missing. Throws when
 * unset, same as AuthKit itself does at startup.
 */
export function authCookiePassword(): string {
    const password = process.env.WORKOS_COOKIE_PASSWORD;
    if (!password) throw new Error("WORKOS_COOKIE_PASSWORD is not set");
    return password;
}

/**
 * Where the visitor was headed when sign-in started — the `returnTo` that
 * /auth/start handed `getSignInUrl`, read back out of the `state` WorkOS
 * echoes to /auth/callback.
 *
 * AuthKit's own callback reads it the same way (`getStateFromPKCECookieValue`
 * in authkit-nextjs/dist/esm/pkce.js: `unsealData` with this password), but
 * only on success: when the exchange fails, `handleAuth` hands `onError` the
 * raw request and the return path is lost. Without this, a failed sign-in
 * from an Apply button restarted at /jobs instead of the job the person was
 * on. A forged, expired or foreign `state` yields null, never a guess, and the
 * path is re-validated like any other `next`.
 */
export async function returnPathFromAuthState(state: string | null | undefined): Promise<string | null> {
    if (!state) return null;
    try {
        const data = await unsealData<{ returnPathname?: unknown }>(state, { password: authCookiePassword() });
        return typeof data.returnPathname === "string" ? validateNextParam(data.returnPathname) : null;
    } catch {
        return null;
    }
}
