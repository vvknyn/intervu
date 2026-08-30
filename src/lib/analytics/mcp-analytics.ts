import { POSTHOG_PRODUCT } from "@/lib/posthog-options";

export const MCP_ANALYTICS_SURFACE = "mcp";
export const MCP_ANONYMOUS_DISTINCT_ID = "anonymous";

export const MCP_ANALYTICS_EVENTS = {
  initialize: "mcp_initialize",
  tools_listed: "mcp_tools_listed",
  tool_called: "mcp_tool_called",
  auth_failed: "mcp_auth_failed",
} as const;

export type McpAnalyticsEvent =
  (typeof MCP_ANALYTICS_EVENTS)[keyof typeof MCP_ANALYTICS_EVENTS];

export type McpCapturePayload = {
  event: McpAnalyticsEvent;
  distinct_id: string;
  properties: Record<string, string | boolean>;
};

const DEFAULT_POSTHOG_CAPTURE_HOST = "https://us.i.posthog.com";

function baseProperties(): Record<string, string> {
  return { product: POSTHOG_PRODUCT, surface: MCP_ANALYTICS_SURFACE };
}

export function shouldCaptureMcpEvent(apiKey: string | undefined | null): boolean {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

export function posthogCaptureUrl(host: string | undefined | null): string {
  const trimmed = host?.trim();
  if (trimmed && trimmed.length > 0 && !trimmed.startsWith("/")) {
    return `${trimmed.replace(/\/+$/, "")}/capture/`;
  }
  return `${DEFAULT_POSTHOG_CAPTURE_HOST}/capture/`;
}

export function posthogCaptureBody(
  apiKey: string,
  payload: McpCapturePayload,
): string {
  return JSON.stringify({
    api_key: apiKey,
    event: payload.event,
    distinct_id: payload.distinct_id,
    properties: payload.properties,
  });
}

export function mcpAuthFailedCapture(): McpCapturePayload {
  return {
    event: MCP_ANALYTICS_EVENTS.auth_failed,
    distinct_id: MCP_ANONYMOUS_DISTINCT_ID,
    properties: baseProperties(),
  };
}

/** Maps `mcpCallLabel` output to a request-level capture, or null when not tracked. */
export function mcpRequestCaptureFromLabel(
  label: string,
  uid: string,
): McpCapturePayload | null {
  if (label === "initialize") {
    return {
      event: MCP_ANALYTICS_EVENTS.initialize,
      distinct_id: uid,
      properties: baseProperties(),
    };
  }
  if (label === "tools/list") {
    return {
      event: MCP_ANALYTICS_EVENTS.tools_listed,
      distinct_id: uid,
      properties: baseProperties(),
    };
  }
  return null;
}

export function mcpToolCalledCapture(
  tool: string,
  isError: boolean,
  uid: string,
): McpCapturePayload {
  return {
    event: MCP_ANALYTICS_EVENTS.tool_called,
    distinct_id: uid,
    properties: {
      ...baseProperties(),
      tool,
      is_error: isError,
    },
  };
}

/** Fire-and-forget PostHog ingest — never throws. */
export async function captureMcpEvent(payload: McpCapturePayload): Promise<void> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!shouldCaptureMcpEvent(apiKey)) return;

  try {
    await fetch(posthogCaptureUrl(process.env.NEXT_PUBLIC_POSTHOG_HOST), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: posthogCaptureBody(apiKey!, payload),
    });
  } catch {
    // Analytics must never break MCP handling.
  }
}
