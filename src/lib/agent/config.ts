import { NextResponse } from "next/server";

/**
 * Shared config for the intervu agent/MCP feature.
 *
 * Single source of truth for Firestore collection names and the numeric
 * limits every later task (credentials, OAuth, rate limiter, tools) reads
 * from — do not duplicate these values elsewhere.
 */
export const AGENT = {
    issuer(): string {
        return process.env.NEXT_PUBLIC_SITE_URL ?? "https://intervu.cc";
    },
    collections: {
        clients: "agent_clients",
        codes: "agent_codes",
        credentials: "agent_credentials",
    },
    RATE_LIMIT: 60,
    /**
     * The two public, unauthenticated OAuth endpoints (`/api/oauth/register`,
     * `/api/oauth/token`) key their rate limit by caller IP, not credential —
     * and hosted connectors (claude.ai, ChatGPT custom connectors) proxy
     * every one of THEIR users' calls through a shared pool of provider
     * egress IPs. Budgeting those two routes at the same 60/hr as a single
     * MCP credential would let one intervu user on a hosted connector burn
     * the whole shared IP's budget and 429 every other intervu user behind
     * the same egress IP. Wider on purpose — these routes only mint/refresh
     * tokens, they never touch job data or a user's account.
     */
    PUBLIC_RATE_LIMIT: 600,
    RATE_WINDOW_MS: 3_600_000,
    RESULT_CAP: 20,
    CODE_TTL_MS: 300_000,
    ACCESS_TTL_MS: 3_600_000,
    /** DCR (`/api/oauth/register`) request body caps — this endpoint is
     *  public/unauthenticated, so its attacker-controlled fields need a
     *  ceiling before they ever reach storage. */
    MAX_REDIRECT_URIS: 10,
    MAX_REDIRECT_URI_LENGTH: 2048,
    MAX_CLIENT_NAME_LENGTH: 256,
};

/**
 * The canonical `claude mcp add` invocation for connecting Claude Code to
 * this server. Both the settings page's "Connected agents" section and the
 * public /agents page show this exact command — one function, not two
 * hand-typed copies, so the two surfaces can never drift apart.
 */
export function claudeCodeConnectCommand(mcpUrl: string): string {
    return `claude mcp add --transport http intervu ${mcpUrl} --header "Authorization: Bearer YOUR_TOKEN"`;
}

/**
 * The one chat-apps connect story. Both the settings page's "Connected
 * agents" section and the public /agents page describe how a chat app
 * connects — `primary` is the connector flow, `alternate` is the
 * manual-token fallback — so the two surfaces can never tell two different
 * stories about the same category of client (one saying OAuth, the other
 * saying paste-a-token).
 */
export function chatAppConnectInstruction(): { primary: string; alternate: string } {
    return {
        primary: "Add intervu as a connector by URL and sign in when your app asks.",
        alternate: "Some apps ask for a token instead — generate one in Settings → Connected agents.",
    };
}

/**
 * The one RFC 9728 protected-resource-metadata response, shared by the bare
 * `/.well-known/oauth-protected-resource` route and its `[...path]`
 * catch-all sibling (IMPORTANT 5 review fix — some MCP clients insert the
 * protected resource's own path segment, e.g.
 * `/.well-known/oauth-protected-resource/api/mcp`, per RFC 9728 §3.1's
 * path-insertion form; both must answer with the SAME body and cache
 * lifetime, so this is the one place that response is built rather than two
 * routes hand-copying it out of sync.
 */
export function protectedResourceMetadataResponse(): Response {
    const issuer = AGENT.issuer();
    return NextResponse.json(
        { resource: `${issuer}/api/mcp`, authorization_servers: [issuer] },
        { headers: { "Cache-Control": "public, max-age=3600" } }
    );
}
