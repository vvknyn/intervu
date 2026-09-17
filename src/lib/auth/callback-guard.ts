import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/seo/constants";
import { validateNextParam } from "@/lib/auth/product-routes";

/**
 * True when a request to /auth/callback carries neither `code` nor `error`
 * — i.e. it wasn't sent here by WorkOS at all (back-button, a stale
 * bookmark, a crawler). The WorkOS handleAuth() handler throws on ANY
 * missing-param case and always answers with the SAME generic 500 JSON
 * (`errorResponseWithFallback` in
 * @workos-inc/authkit-nextjs/dist/esm/authkit-callback-route.js) — correct
 * for a broken WorkOS redirect (a real `code`/`state` mismatch, expired
 * PKCE cookie, etc.), but wrong for someone who just wandered here
 * directly. Only `code`/`error` gate this: those are the two param shapes
 * WorkOS itself sends here (success carries `code`, a denied/failed
 * authorization carries `error`), so every WorkOS-originated hit still
 * reaches handleAuth unchanged.
 */
export function isDirectCallbackHit(searchParams: URLSearchParams): boolean {
    return !searchParams.has("code") && !searchParams.has("error");
}

/**
 * Every way /auth/callback can fail: a request that never came from WorkOS
 * at all ("direct_hit", guarded below), or a WorkOS exchange that itself
 * errored — expired PKCE, state mismatch, a denied/failed authorization, a
 * network failure ("exchange_failed", guarded by `onError` in
 * app/auth/callback/route.ts). Named for server-side logs only: WorkOS
 * collapses every exchange failure into the same generic response, so we
 * can't tell a denied consent from an expired link from out here, and the
 * retry page shows the same honest copy for both rather than pretending
 * otherwise.
 */
export type CallbackFailureClass = "direct_hit" | "exchange_failed";

/**
 * One redirect builder for every failure class, so a class can't drop
 * `next` while another keeps it. `next` is only ever what the *failing*
 * request itself already carried — WorkOS's callback URL doesn't include
 * the app's return-to (that lives in the encrypted PKCE state, which is
 * exactly what a failed exchange can't be trusted to decode), so most
 * classes forward nothing and `/auth/start` falls back to its own default.
 */
export function buildCallbackRetryRedirect(request: NextRequest, failureClass: CallbackFailureClass): NextResponse {
    const url = new URL("/auth/retry", getSiteUrl());
    url.searchParams.set("reason", failureClass);
    const next = validateNextParam(request.nextUrl.searchParams.get("next"));
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, 307);
}

/**
 * Wraps a WorkOS callback handler with the direct-hit guard above. Takes
 * the handler as a parameter (rather than importing handleAuth itself) so
 * this module — and its tests — never load the WorkOS SDK.
 */
export function withDirectHitGuard(workosCallback: (request: NextRequest) => Promise<Response>) {
    return async function GET(request: NextRequest): Promise<Response> {
        if (isDirectCallbackHit(request.nextUrl.searchParams)) {
            return buildCallbackRetryRedirect(request, "direct_hit");
        }
        return workosCallback(request);
    };
}
