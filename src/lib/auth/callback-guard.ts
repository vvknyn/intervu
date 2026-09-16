import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/seo/constants";

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
 * Wraps a WorkOS callback handler with the direct-hit guard above. Takes
 * the handler as a parameter (rather than importing handleAuth itself) so
 * this module — and its tests — never load the WorkOS SDK.
 */
export function withDirectHitGuard(workosCallback: (request: NextRequest) => Promise<Response>) {
    return async function GET(request: NextRequest): Promise<Response> {
        if (isDirectCallbackHit(request.nextUrl.searchParams)) {
            return NextResponse.redirect(new URL("/login", getSiteUrl()), 307);
        }
        return workosCallback(request);
    };
}
