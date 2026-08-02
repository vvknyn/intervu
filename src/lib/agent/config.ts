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
    RATE_WINDOW_MS: 3_600_000,
    RESULT_CAP: 20,
    CODE_TTL_MS: 300_000,
    ACCESS_TTL_MS: 3_600_000,
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
