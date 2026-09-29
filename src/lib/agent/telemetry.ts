/**
 * PostHog telemetry for MCP tool calls — the `$mcp_tool_call` event PostHog's
 * MCP analytics dashboard is built around (properties `$mcp_tool_name`,
 * `$mcp_is_error`, `$mcp_error_type`, `$mcp_duration_ms`, `$mcp_client_name`,
 * `$mcp_server_name`, `$mcp_session_id`).
 *
 * Before this, the MCP server had guardrail LOG LINES (`log.ts`: rate-limit
 * accepts/rejects, budget exhaustion) and nothing else: no call counts, no
 * per-tool error rate, no latency, no idea which client (Claude, Cursor,
 * mcporter) a call came from. PostHog showed /connect visits and consent
 * screens and then went dark, so "is anyone using the MCP" could only be
 * answered by reading stdout on the box.
 *
 * Rides `postServerCapture` (analytics/server-capture.ts) like
 * `$ai_generation` does: fire-and-forget, a no-op without
 * `NEXT_PUBLIC_POSTHOG_KEY`, never throws, so the tool's own result is
 * never delayed or failed by analytics. `distinct_id` is the account uid —
 * the same id `PostHogProvider` identifies the browser session with — so a
 * person's web and MCP activity land on one PostHog person.
 *
 * No tool INPUT or OUTPUT is sent: a search query, a résumé, a company name
 * would all be PII or corpus data in a third-party store. Only the tool
 * name, timing, the error CLASS and the client label leave the server.
 */
import { postServerCapture } from "@/lib/analytics/server-capture";

export const MCP_TOOL_CALL_EVENT = "$mcp_tool_call";
export const MCP_SERVER_NAME = "velai-agent";

export type McpToolCallTelemetry = {
    /** Catalog tool name (`search_jobs`, …), or the JSON-RPC method for a
     *  call rejected before a tool was resolved (`tools/list`, `POST`). */
    tool: string;
    /** Account uid the credential belongs to — the PostHog distinct id. */
    uid: string;
    durationMs: number;
    isError: boolean;
    /** Bounded error class (`unavailable`, `rate_limited`, `exception`, or
     *  the slug of a tool's own `error` string). Never a raw message. */
    errorType?: string;
    /** The caller's `User-Agent`, truncated — the closest thing a stateless
     *  Streamable HTTP handler has to the `clientInfo` of the initialize
     *  handshake, which it does not retain between requests. */
    clientName?: string;
    sessionId?: string;
};

export function captureMcpToolCall(call: McpToolCallTelemetry): void {
    postServerCapture(MCP_TOOL_CALL_EVENT, call.uid, {
        $mcp_tool_name: call.tool,
        $mcp_server_name: MCP_SERVER_NAME,
        $mcp_duration_ms: call.durationMs,
        $mcp_is_error: call.isError,
        ...(call.errorType ? { $mcp_error_type: call.errorType } : {}),
        ...(call.clientName ? { $mcp_client_name: call.clientName } : {}),
        ...(call.sessionId ? { $mcp_session_id: call.sessionId } : {}),
    });
}

const ERROR_TYPE_MAX = 48;

/**
 * The error class of a tool payload, matching `toolResult`'s (api/mcp/route.ts)
 * idea of failure: `unavailable: true` (search backend down) or a string
 * `error`. The string is slugged and bounded — `"job not found"` becomes
 * `job_not_found` — so a dashboard can group on it and a message that
 * happened to carry an id or a name never reaches PostHog verbatim.
 */
export function mcpErrorType(payload: object): string | undefined {
    if ((payload as { unavailable?: boolean }).unavailable === true) return "unavailable";
    const error = (payload as { error?: unknown }).error;
    if (typeof error !== "string" || error.length === 0) return undefined;
    return error
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, ERROR_TYPE_MAX);
}

const CLIENT_NAME_MAX = 80;

/** `User-Agent` reduced to a label PostHog can group on: first 80 chars,
 *  whitespace collapsed; `undefined` when the header is missing. */
export function mcpClientName(userAgent: string | null): string | undefined {
    if (!userAgent) return undefined;
    const trimmed = userAgent.replace(/\s+/g, " ").trim();
    return trimmed.length > 0 ? trimmed.slice(0, CLIENT_NAME_MAX) : undefined;
}

/** `tools/call:search_jobs` → `search_jobs`; any other rate-limit label
 *  (`tools/list`, `initialize`, `GET`) is kept as-is. */
export function mcpToolFromLabel(label: string): string {
    return label.startsWith("tools/call:") ? label.slice("tools/call:".length) : label;
}
