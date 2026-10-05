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
 * `next` while another keeps it. WorkOS's callback URL doesn't carry the
 * app's return-to as a plain param: it lives in the sealed `state`, which
 * `onError` reads back with `returnPathFromAuthState` (authkit-state.ts) and
 * passes here as `stateNext`, so Start again returns to the job the person
 * was on. A direct hit has no `state`, so only a `next` the failing request
 * itself carried can apply, and with neither `/auth/start` falls back to its
 * own default.
 */
export function buildCallbackRetryRedirect(
    request: NextRequest,
    failureClass: CallbackFailureClass,
    stateNext?: string | null,
): NextResponse {
    const url = new URL("/auth/retry", getSiteUrl());
    url.searchParams.set("reason", failureClass);
    const next = validateNextParam(stateNext) ?? validateNextParam(request.nextUrl.searchParams.get("next"));
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, 307);
}

/**
 * Where a failed callback (or the retry page it lands on) sends the visitor.
 * A visitor who already holds a valid session must never see "We couldn't
 * finish signing you in": the callback deletes its one-use PKCE cookie on the
 * first hit, so any replay of the same URL (tab restore, double navigation,
 * back button) fails as `missing_pkce_cookie` although hit #1 succeeded.
 * Every failure class and code funnels through here, so none can skip it.
 * Their own validated `next` wins; otherwise the app's default landing.
 */
export type CallbackFailureLanding = { kind: "redirect"; path: string } | { kind: "retry" };

export function decideCallbackFailureLanding(input: {
    hasSession: boolean;
    rawNext: string | null | undefined;
}): CallbackFailureLanding {
    if (!input.hasSession) return { kind: "retry" };
    return { kind: "redirect", path: validateNextParam(input.rawNext) ?? "/jobs" };
}

/** `CallbackError.code` when it is a plain snake_case token, else "unclassified" (errors from authenticateWithCode carry none). */
export function callbackErrorCode(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code) ? code : "unclassified";
}

/** Stable, greppable log line. Only the error code and session presence — never the OAuth code, state, tokens or email. */
export function callbackFailureLogLine(code: string, signedIn: boolean): string {
    return `[auth] callback_failed code=${code} signed_in=${signedIn}`;
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
