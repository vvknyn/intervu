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
