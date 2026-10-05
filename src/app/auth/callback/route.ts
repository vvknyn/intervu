import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/seo/constants";
import { captureServerEvent } from "@/lib/analytics/server-capture";
import { getServerUser } from "@/lib/auth/server-user";
import {
    buildCallbackRetryRedirect,
    callbackErrorCode,
    callbackFailureLogLine,
    decideCallbackFailureLanding,
    withDirectHitGuard,
} from "@/lib/auth/callback-guard";
import { completeAuthKitSignIn } from "@/lib/auth/authkit-sign-in-complete";
import { returnPathFromAuthState } from "@/lib/auth/authkit-state";
import {
    EMAIL_CODE_COOKIE_NAME,
    EMAIL_CODE_PATH,
    emailCodeCookieOptions,
    pendingEmailCodeFromError,
    sealPendingEmailCode,
} from "@/lib/auth/email-code-pending";

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
 * `onSuccess` hands the fresh session to `completeAuthKitSignIn`
 * (src/lib/auth/authkit-sign-in-complete.ts): provisioning and the
 * once-per-account `signup_completed` cookie, shared with the emailed-code
 * step so a held sign-in finishes exactly like this one.
 *
 * `withDirectHitGuard` (src/lib/auth/callback-guard.ts) redirects a request
 * that carries neither `code` nor `error` straight to /auth/retry instead
 * of letting it fall into handleAuth's generic 500 — see that file for why.
 *
 * `onError` below covers every OTHER way the exchange can fail (expired
 * PKCE, state mismatch, a denied authorization, `authenticateWithCode`
 * throwing) — handleAuth catches all of them internally and would
 * otherwise answer with a raw 500 JSON body (`{"error":{"message":"Something
 * went wrong"}}`) that a visitor just sees as a broken page. The real
 * error's code is logged and captured here (server-side only, never in the
 * response), and a visitor who already holds a valid session is sent on to
 * the app instead of the error page — see `decideCallbackFailureLanding`.
 *
 * One "failure" is not a failure: WorkOS answers `email_verification_required`
 * when it wants the person to type a code it just emailed before the Google
 * sign-in counts. That goes to the code step (email-code-pending.ts) with the
 * held sign-in sealed in a cookie, not to "We couldn't finish signing you in",
 * where Start again only sent another code and failed again. Every branch
 * keeps where the person was headed, read back out of `state`.
 */
export const GET = withDirectHitGuard(
    handleAuth({
        baseURL: getSiteUrl(),
        onError: async ({ error, request }) => {
            const user = await getServerUser();
            const code = callbackErrorCode(error);
            console.error(callbackFailureLogLine(code, user !== null));
            captureServerEvent("auth_callback_failed", user?.uid ?? crypto.randomUUID(), { code });
            const returnPath = await returnPathFromAuthState(request.nextUrl.searchParams.get("state"));
            const landing = decideCallbackFailureLanding({
                hasSession: user !== null,
                rawNext: returnPath ?? request.nextUrl.searchParams.get("next"),
            });
            if (landing.kind === "redirect") return NextResponse.redirect(new URL(landing.path, getSiteUrl()), 307);

            const pending = pendingEmailCodeFromError(error);
            if (pending) {
                try {
                    const sealed = await sealPendingEmailCode({ ...pending, next: returnPath });
                    const response = NextResponse.redirect(new URL(EMAIL_CODE_PATH, getSiteUrl()), 307);
                    response.cookies.set(EMAIL_CODE_COOKIE_NAME, sealed, emailCodeCookieOptions());
                    return response;
                } catch (sealError) {
                    console.error("[auth] could not hold the sign-in for its email code:", sealError);
                }
            }
            return buildCallbackRetryRedirect(request, "exchange_failed", returnPath);
        },
        onSuccess: async ({ user, authenticationMethod }) => {
            await completeAuthKitSignIn(user, authenticationMethod);
        },
    }),
);
