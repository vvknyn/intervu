/**
 * Single source of truth for the /connect page's supported AI clients.
 *
 * Consumed by both a "use client" component (connect-client.tsx, for the tab
 * list + UI copy) and a "use server" action (connect-waitlist.ts, for the
 * `client` field's validation enum) — kept in its own plain module (no
 * client/server directive) so both boundaries can import it without pulling
 * in the other's bundle.
 *
 * `supportsDirectConnect: false` marks a client whose app can't take a
 * pasted MCP URL today (e.g. the consumer Gemini app) — the UI uses this
 * capability field to skip rendering the copy-URL bar for that client
 * instead of branching on the client id.
 */
export const CONNECT_CLIENTS = [
  { id: "claude", label: "Claude", badge: "beta — rolling out", supportsDirectConnect: true },
  {
    id: "chatgpt",
    label: "ChatGPT",
    badge: "paid plans · developer mode",
    supportsDirectConnect: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    badge: "via Gemini CLI today",
    supportsDirectConnect: false,
  },
  { id: "gemini-cli", label: "Gemini CLI", badge: undefined, supportsDirectConnect: true },
  { id: "cursor", label: "Cursor", badge: undefined, supportsDirectConnect: true },
] as const;

export type ConnectClientId = (typeof CONNECT_CLIENTS)[number]["id"];

/** Non-empty tuple of every client id, for zod's `z.enum()`. */
export const CONNECT_CLIENT_IDS = CONNECT_CLIENTS.map((c) => c.id) as [
  ConnectClientId,
  ...ConnectClientId[],
];
