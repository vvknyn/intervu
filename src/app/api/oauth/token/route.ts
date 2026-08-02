import { NextResponse } from "next/server";
import { firestoreStore } from "@/lib/agent/store";
import { exchangeCode, refreshAccess } from "@/lib/agent/oauth";

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
 * POST /api/oauth/token — authorization_code exchange + refresh_token rotation.
 *
 * oauth.ts returns detailed error strings (unknown code / client mismatch /
 * verifier rules / etc.) for our own logs and tests. None of that detail is
 * safe to hand to the wire — per RFC 6749 §5.2, every grant failure here
 * collapses to the single generic `invalid_grant` (or `invalid_request` for
 * a malformed request shape), with the real reason logged server-side only.
 */
export async function POST(request: Request) {
    let body: Record<string, string>;
    try {
        body = await parseTokenRequestBody(request);
    } catch {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const { grant_type, client_id } = body;
    const store = firestoreStore();

    if (grant_type === "authorization_code") {
        const { code, redirect_uri, code_verifier } = body;
        if (!code || !client_id || !redirect_uri || !code_verifier) {
            return NextResponse.json({ error: "invalid_request" }, { status: 400 });
        }
        const result = await exchangeCode(store, { code, clientId: client_id, redirectUri: redirect_uri, codeVerifier: code_verifier });
        if ("error" in result) {
            console.error(`[oauth/token] exchangeCode rejected client_id=${client_id}: ${result.error}`);
            return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
        }
        return NextResponse.json(result);
    }

    if (grant_type === "refresh_token") {
        const { refresh_token } = body;
        if (!refresh_token || !client_id) {
            return NextResponse.json({ error: "invalid_request" }, { status: 400 });
        }
        const result = await refreshAccess(store, { refreshSecret: refresh_token, clientId: client_id });
        if ("error" in result) {
            console.error(`[oauth/token] refreshAccess rejected client_id=${client_id}: ${result.error}`);
            return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
        }
        return NextResponse.json(result);
    }

    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
}
