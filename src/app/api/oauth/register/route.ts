import { NextResponse } from "next/server";
import { getAgentStore } from "@/lib/agent/store";
import { registerClient } from "@/lib/agent/oauth";
import { AGENT, trimAndCapLabel } from "@/lib/agent/config";
import { checkRateLimit, rateLimitedResponse } from "@/lib/agent/rate-limit";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";

/**
 * The DCR request body is attacker-controlled JSON — every field read from it
 * must be type-validated at this boundary, not just `redirect_uris`. RFC 7591
 * lets a server ignore invalid client metadata rather than reject the whole
 * registration, so a non-string `client_name` (object, array, number, empty
 * string) is treated as absent instead of flowing untyped into storage, where
 * it would later crash the consent page's React render. A wildly long name
 * (still just a display label, not something structural like a redirect_uri)
 * is truncated rather than rejected — the client just gets a shorter label,
 * not a failed registration.
 */
export function sanitizeClientName(value: unknown): string | undefined {
    return trimAndCapLabel(value, AGENT.MAX_CLIENT_NAME_LENGTH);
}

/**
 * POST /api/oauth/register — RFC 7591 dynamic client registration.
 * Public/unauthenticated: any MCP client can self-register (token_endpoint_auth_method
 * is always "none" — PKCE is the client-side secret, per OAuth 2.1 public-client model).
 * Rate-limited per caller IP (no credential exists yet at this point) before any
 * parsing or storage work happens, so an anonymous flood can't rack up unbounded
 * Firestore writes. Budgeted at `AGENT.PUBLIC_RATE_LIMIT`, not the default
 * per-credential `AGENT.RATE_LIMIT` — this route is keyed by IP, and hosted
 * connectors (claude.ai, ChatGPT) share one egress IP across every one of
 * their users (see `PUBLIC_RATE_LIMIT`'s doc comment, config.ts).
 */
export async function POST(request: Request) {
    const rate = checkRateLimit(`dcr:${resolveClientIpFromHeaders(request.headers)}`, undefined, AGENT.PUBLIC_RATE_LIMIT, "oauth_register");
    if (!rate.ok) return rateLimitedResponse(rate.retryAfterSec);

    let body: { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
    }

    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.every((uri) => typeof uri === "string")) {
        return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
    }

    const result = await registerClient(getAgentStore(), {
        client_name: sanitizeClientName(body.client_name),
        redirect_uris: body.redirect_uris,
    });

    if ("error" in result) {
        console.error(`[oauth/register] registerClient rejected: ${result.error}`);
        return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
    }

    // Which client registered and how it asked to authenticate — the one line
    // that shows a hosted connector's handshake reached this far (the secret
    // never exists: every client here is public, whatever method it asked for).
    const hosts = [...new Set(result.client.redirectUris.map((uri) => new URL(uri).host))].join(",");
    const asked = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method.slice(0, 40) : "-";
    console.log(`[oauth/register] ok client=${result.client.id.slice(0, 8)} name=${JSON.stringify(result.client.name)} hosts=${hosts} asked_auth=${JSON.stringify(asked)}`);

    return NextResponse.json(
        {
            client_id: result.client.id,
            client_name: result.client.name,
            redirect_uris: result.client.redirectUris,
            token_endpoint_auth_method: "none",
        },
        { status: 201 }
    );
}
