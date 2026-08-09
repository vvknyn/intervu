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
 *
 * `openUrl` (mcp clients only — R2, 2026-08-09 user report): where "Open
 * <client>" points, alongside the copy-the-connector-URL step. Verified
 * against each vendor's current documentation the day this was added —
 * their dedicated connector-management page where one exists (a deep link
 * gets the visitor straight to the paste-a-URL screen the copy step feeds),
 * else the client's own main app URL, never a guess or an invented path:
 *   - claude: https://claude.ai/settings/connectors — Anthropic's own
 *     support docs (support.claude.com/en/articles/11175166) name this
 *     exact page for adding a custom connector.
 *   - chatgpt: no stable, documented deep link to the Connectors sub-screen
 *     found (it's reached by clicking through Settings inside the SPA, no
 *     URL cited in OpenAI's own help center) — falls back to the main app,
 *     https://chatgpt.com.
 *   - gemini: same gap — Google's support doc (support.google.com/gemini/
 *     answer/17209137) describes a click path ("Settings & help > Connected
 *     Apps"), not a URL — falls back to the main app, https://gemini.google.com.
 *   - cursor: MCP setup lives in the desktop app's own Settings panel, not
 *     a web page at all — falls back to the marketing/download site,
 *     https://cursor.com.
 * A vendor may add a real deep link later; when one shows up in their docs,
 * update the entry here — this table is the only place the URL lives.
 */
export const CONNECT_CLIENTS = [
  {
    id: "claude",
    label: "Claude",
    badge: "beta — rolling out",
    kind: "mcp",
    supportsDirectConnect: true,
    openUrl: "https://claude.ai/settings/connectors",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    badge: "paid plans",
    kind: "mcp",
    supportsDirectConnect: true,
    openUrl: "https://chatgpt.com",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    badge: "self-hosted · personal key",
    kind: "local",
    supportsDirectConnect: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    badge: "us · web app",
    kind: "mcp",
    supportsDirectConnect: true,
    openUrl: "https://gemini.google.com",
  },
  {
    id: "cursor",
    label: "Cursor",
    badge: undefined,
    kind: "mcp",
    supportsDirectConnect: true,
    openUrl: "https://cursor.com",
  },
] as const;

export type ConnectClientId = (typeof CONNECT_CLIENTS)[number]["id"];

/** Non-empty tuple of every client id, for zod's `z.enum()`. */
export const CONNECT_CLIENT_IDS = CONNECT_CLIENTS.map((c) => c.id) as [
  ConnectClientId,
  ...ConnectClientId[],
];
