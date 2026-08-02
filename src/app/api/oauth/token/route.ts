import { NextResponse } from "next/server";
import { firestoreStore } from "@/lib/agent/store";
import { exchangeCode, refreshAccess } from "@/lib/agent/oauth";
import { AGENT } from "@/lib/agent/config";
import { checkRateLimit, clientIpFromRequest, rateLimitedResponse } from "@/lib/agent/rate-limit";

/** RFC 6749 token requests are form-urlencoded by spec, but MCP clients vary — accept JSON too. */
async function parseTokenRequestBody(request: Request): Promise<Record<string, string>> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        return await request.json();
    }
    const form = await request.formData();
    return Object.fromEntries(form.entries()) as Record<string, string>;
}

/**
 * RFC 6749 §5.1 MUST: "The authorization server MUST include the HTTP
 * 'Cache-Control' response header field... with a value of 'no-store'" —
 * a token response (or its error) cached by an intermediary would replay a
 * stale access/refresh token pair. The ONE place this route builds a JSON
 * response, so every return below — success AND every error path — carries
 * it rather than four call sites each remembering the header separately.
 */
function tokenJson(body: object, status = 200): Response {
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/oauth/token — authorization_code exchange + refresh_token rotation.
 *
 * oauth.ts returns detailed error strings (unknown code / client mismatch /
 * verifier rules / etc.) for our own logs and tests. None of that detail is
 * safe to hand to the wire — per RFC 6749 §5.2, every grant failure here
 * collapses to the single generic `invalid_grant` (or `invalid_request` for
 * a malformed request shape), with the real reason logged server-side only.
 *
 * Rate-limited per caller IP before any parsing: a code/refresh-token guess
 * is exactly the kind of request an anonymous flood would use to brute-force
 * this endpoint, so the limiter has to run before any of that work, not after.
 * Budgeted at `AGENT.PUBLIC_RATE_LIMIT` (see its doc comment, config.ts) —
 * this is the token refresh path every hosted connector's users share one
 * egress IP to reach, so the default per-credential budget would starve them.
 */
export async function POST(request: Request) {
    const rate = checkRateLimit(`token:${clientIpFromRequest(request)}`, undefined, AGENT.PUBLIC_RATE_LIMIT);
    if (!rate.ok) return rateLimitedResponse(rate.retryAfterSec);

    let body: Record<string, string>;
    try {
        body = await parseTokenRequestBody(request);
    } catch {
        return tokenJson({ error: "invalid_request" }, 400);
    }

    const { grant_type, client_id } = body;
    const store = firestoreStore();

    if (grant_type === "authorization_code") {
        const { code, redirect_uri, code_verifier } = body;
        if (!code || !client_id || !redirect_uri || !code_verifier) {
            return tokenJson({ error: "invalid_request" }, 400);
        }
        const result = await exchangeCode(store, { code, clientId: client_id, redirectUri: redirect_uri, codeVerifier: code_verifier });
        if ("error" in result) {
            console.error(`[oauth/token] exchangeCode rejected client_id=${client_id}: ${result.error}`);
            return tokenJson({ error: "invalid_grant" }, 400);
        }
        return tokenJson(result);
    }

    if (grant_type === "refresh_token") {
        const { refresh_token } = body;
        if (!refresh_token || !client_id) {
            return tokenJson({ error: "invalid_request" }, 400);
        }
        const result = await refreshAccess(store, { refreshSecret: refresh_token, clientId: client_id });
        if ("error" in result) {
            console.error(`[oauth/token] refreshAccess rejected client_id=${client_id}: ${result.error}`);
            return tokenJson({ error: "invalid_grant" }, 400);
        }
        return tokenJson(result);
    }

    return tokenJson({ error: "invalid_request" }, 400);
}
