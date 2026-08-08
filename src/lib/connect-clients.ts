/**
 * Single source of truth for the /connect page's supported AI clients.
 *
 * Consumed by both a "use client" component (connect-client.tsx, for the MCP
 * client picker + UI copy) and a "use server" action (connect-waitlist.ts,
 * for the `client` field's validation enum) — kept in its own plain module
 * (no client/server directive) so both boundaries can import it without
 * pulling in the other's bundle.
 *
 * `kind` is the chokepoint /connect renders on: "mcp" clients share ONE
 * paste-a-connector-URL flow (the picker); "local" (OpenClaw) installs on
 * the visitor's machine and gets its own section below, not a picker tab.
 *
 * `supportsDirectConnect: false` marks a client whose app can't take a
 * pasted MCP URL today — still read by the /mock completeness demo
 * (CompletenessMock.tsx); every real client here is currently `true`.
 */
export const CONNECT_CLIENTS = [
  { id: "claude", label: "Claude", badge: "beta — rolling out", kind: "mcp", supportsDirectConnect: true },
  { id: "chatgpt", label: "ChatGPT", badge: "paid plans", kind: "mcp", supportsDirectConnect: true },
  {
    id: "openclaw",
    label: "OpenClaw",
    badge: "self-hosted · personal key",
    kind: "local",
    supportsDirectConnect: true,
  },
  { id: "gemini", label: "Gemini", badge: "us · web app", kind: "mcp", supportsDirectConnect: true },
  { id: "cursor", label: "Cursor", badge: undefined, kind: "mcp", supportsDirectConnect: true },
] as const;

export type ConnectClientId = (typeof CONNECT_CLIENTS)[number]["id"];

/** Non-empty tuple of every client id, for zod's `z.enum()`. */
export const CONNECT_CLIENT_IDS = CONNECT_CLIENTS.map((c) => c.id) as [
  ConnectClientId,
  ...ConnectClientId[],
];
