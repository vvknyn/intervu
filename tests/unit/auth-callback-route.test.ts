import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
    buildCallbackRetryRedirect,
    callbackErrorCode,
    callbackFailureLogLine,
    decideCallbackFailureLanding,
    isDirectCallbackHit,
    withDirectHitGuard,
} from "../../src/lib/auth/callback-guard";

// getSiteUrl() (src/lib/seo/constants.ts) throws when this is unset — it
// deliberately has no fallback domain. withDirectHitGuard's redirect path
// calls it, so the tests below need it set.
process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";

test("isDirectCallbackHit is true with neither code nor error", () => {
    assert.equal(isDirectCallbackHit(new URLSearchParams()), true);
    assert.equal(isDirectCallbackHit(new URLSearchParams("state=abc")), true);
});

test("isDirectCallbackHit is false when code is present", () => {
    assert.equal(isDirectCallbackHit(new URLSearchParams("code=abc")), false);
});

test("isDirectCallbackHit is false when error is present", () => {
    assert.equal(isDirectCallbackHit(new URLSearchParams("error=access_denied")), false);
});

test("isDirectCallbackHit is not fooled by an unrelated param name", () => {
    assert.equal(isDirectCallbackHit(new URLSearchParams("token=abc")), true);
});

test("withDirectHitGuard: no params redirects to /auth/retry?reason=direct_hit on the canonical origin, without calling the WorkOS handler", async () => {
    let called = false;
    const stub = async () => {
        called = true;
        return new Response(null, { status: 200 });
    };
    const GET = withDirectHitGuard(stub);
    const response = await GET(new NextRequest("https://velai.app/auth/callback"));

    assert.equal(called, false);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://velai.app/auth/retry?reason=direct_hit");
});

test("withDirectHitGuard: ?code=abc delegates to the WorkOS handler untouched", async () => {
    let receivedUrl: string | null = null;
    const stub = async (request: NextRequest) => {
        receivedUrl = request.url;
        return new Response(null, { status: 307, headers: { location: "https://velai.app/jobs" } });
    };
    const GET = withDirectHitGuard(stub);
    const response = await GET(new NextRequest("https://velai.app/auth/callback?code=abc&state=xyz"));

    assert.equal(receivedUrl, "https://velai.app/auth/callback?code=abc&state=xyz");
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://velai.app/jobs");
});

test("withDirectHitGuard: ?error=access_denied delegates to the WorkOS handler, not redirected by the guard", async () => {
    let called = false;
    const stub = async () => {
        called = true;
        return new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500 });
    };
    const GET = withDirectHitGuard(stub);
    const response = await GET(new NextRequest("https://velai.app/auth/callback?error=access_denied&error_description=user+denied"));

    assert.equal(called, true);
    assert.equal(response.status, 500);
});

// buildCallbackRetryRedirect is the one redirect builder both failure
// classes route through (the guard above for "direct_hit", `onError` in
// app/auth/callback/route.ts for "exchange_failed") — covering both here
// proves neither class can drift from the other's shape.
test("buildCallbackRetryRedirect: direct_hit lands on /auth/retry with reason=direct_hit, no next", () => {
    const response = buildCallbackRetryRedirect(new NextRequest("https://velai.app/auth/callback"), "direct_hit");
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/auth/retry");
    assert.equal(location.searchParams.get("reason"), "direct_hit");
    assert.equal(location.searchParams.has("next"), false);
});

test("buildCallbackRetryRedirect: exchange_failed lands on /auth/retry with reason=exchange_failed", () => {
    const response = buildCallbackRetryRedirect(
        new NextRequest("https://velai.app/auth/callback?code=abc&state=xyz"),
        "exchange_failed",
    );
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/auth/retry");
    assert.equal(location.searchParams.get("reason"), "exchange_failed");
});

test("buildCallbackRetryRedirect: preserves a valid next param, for either failure class", () => {
    for (const failureClass of ["direct_hit", "exchange_failed"] as const) {
        const response = buildCallbackRetryRedirect(
            new NextRequest(`https://velai.app/auth/callback?next=${encodeURIComponent("/jobs?job=abc")}`),
            failureClass,
        );
        const location = new URL(response.headers.get("location")!);
        assert.equal(location.searchParams.get("next"), "/jobs?job=abc", failureClass);
    }
});

test("buildCallbackRetryRedirect: drops an unsafe (open-redirect) next param", () => {
    const response = buildCallbackRetryRedirect(
        new NextRequest("https://velai.app/auth/callback?next=https://evil.example.com"),
        "direct_hit",
    );
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.has("next"), false);
});

// The decision is independent of the failure code: `onError` (any CallbackError
// code, or a non-CallbackError throw) and the /auth/retry page both call it
// with only the session and `next`, so a replayed callback (missing_pkce_cookie)
// and a state mismatch (oauth_state_mismatch) take the same branch.
test("decideCallbackFailureLanding: no session shows the retry page", () => {
    assert.deepEqual(decideCallbackFailureLanding({ hasSession: false, rawNext: "/jobs?job=abc" }), { kind: "retry" });
    assert.deepEqual(decideCallbackFailureLanding({ hasSession: false, rawNext: null }), { kind: "retry" });
});

test("decideCallbackFailureLanding: a valid session redirects to the validated next, else /jobs", () => {
    assert.deepEqual(decideCallbackFailureLanding({ hasSession: true, rawNext: "/jobs?job=abc" }), {
        kind: "redirect",
        path: "/jobs?job=abc",
    });
    assert.deepEqual(decideCallbackFailureLanding({ hasSession: true, rawNext: null }), { kind: "redirect", path: "/jobs" });
    assert.deepEqual(decideCallbackFailureLanding({ hasSession: true, rawNext: undefined }), { kind: "redirect", path: "/jobs" });
});

test("decideCallbackFailureLanding: a valid session never redirects to an open-redirect next", () => {
    for (const rawNext of ["https://evil.example.com", "//evil.example.com"]) {
        assert.deepEqual(decideCallbackFailureLanding({ hasSession: true, rawNext }), { kind: "redirect", path: "/jobs" }, rawNext);
    }
});

test("callbackErrorCode: reads the CallbackError code for any code, not just missing_pkce_cookie", () => {
    for (const code of ["missing_pkce_cookie", "oauth_state_mismatch", "missing_auth_params"]) {
        assert.equal(callbackErrorCode(Object.assign(new Error("boom"), { code })), code);
    }
});

test("callbackErrorCode: an error without a plain token code is unclassified, never echoed", () => {
    assert.equal(callbackErrorCode(new Error("authenticateWithCode blew up")), "unclassified");
    assert.equal(callbackErrorCode(null), "unclassified");
    assert.equal(callbackErrorCode("a string"), "unclassified");
    assert.equal(callbackErrorCode(Object.assign(new Error("x"), { code: "line one\nforged log line" })), "unclassified");
});

test("callbackFailureLogLine: stable prefix carrying only the code and session presence", () => {
    assert.equal(callbackFailureLogLine("oauth_state_mismatch", false), "[auth] callback_failed code=oauth_state_mismatch signed_in=false");
    assert.equal(callbackFailureLogLine("missing_pkce_cookie", true), "[auth] callback_failed code=missing_pkce_cookie signed_in=true");
});
