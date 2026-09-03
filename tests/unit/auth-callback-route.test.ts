import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isDirectCallbackHit, withDirectHitGuard } from "../../src/lib/auth/callback-guard";

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

test("withDirectHitGuard: no params redirects to /login on the canonical origin, without calling the WorkOS handler", async () => {
    let called = false;
    const stub = async () => {
        called = true;
        return new Response(null, { status: 200 });
    };
    const GET = withDirectHitGuard(stub);
    const response = await GET(new NextRequest("https://velai.app/auth/callback"));

    assert.equal(called, false);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://velai.app/login");
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
