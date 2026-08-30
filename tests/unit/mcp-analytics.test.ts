import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_ANALYTICS_EVENTS,
  MCP_ANONYMOUS_DISTINCT_ID,
  mcpAuthFailedCapture,
  mcpRequestCaptureFromLabel,
  mcpToolCalledCapture,
  posthogCaptureBody,
  posthogCaptureUrl,
  shouldCaptureMcpEvent,
} from "../../src/lib/analytics/mcp-analytics";

test("shouldCaptureMcpEvent is false when the key is missing or blank", () => {
  assert.equal(shouldCaptureMcpEvent(undefined), false);
  assert.equal(shouldCaptureMcpEvent(null), false);
  assert.equal(shouldCaptureMcpEvent(""), false);
  assert.equal(shouldCaptureMcpEvent("   "), false);
  assert.equal(shouldCaptureMcpEvent("phc_test"), true);
});

test("mcpRequestCaptureFromLabel maps initialize and tools/list only", () => {
  assert.deepEqual(mcpRequestCaptureFromLabel("initialize", "user-1"), {
    event: MCP_ANALYTICS_EVENTS.initialize,
    distinct_id: "user-1",
    properties: { product: "intervu", surface: "mcp" },
  });
  assert.deepEqual(mcpRequestCaptureFromLabel("tools/list", "user-2"), {
    event: MCP_ANALYTICS_EVENTS.tools_listed,
    distinct_id: "user-2",
    properties: { product: "intervu", surface: "mcp" },
  });
  assert.equal(mcpRequestCaptureFromLabel("tools/call:search_jobs", "user-1"), null);
  assert.equal(mcpRequestCaptureFromLabel("GET", "user-1"), null);
});

test("mcpToolCalledCapture stamps tool and is_error without input payload", () => {
  assert.deepEqual(
    mcpToolCalledCapture("get_job", true, "uid-abc"),
    {
      event: MCP_ANALYTICS_EVENTS.tool_called,
      distinct_id: "uid-abc",
      properties: {
        product: "intervu",
        surface: "mcp",
        tool: "get_job",
        is_error: true,
      },
    },
  );
});

test("mcpAuthFailedCapture uses a stable anonymous distinct_id", () => {
  assert.deepEqual(mcpAuthFailedCapture(), {
    event: MCP_ANALYTICS_EVENTS.auth_failed,
    distinct_id: MCP_ANONYMOUS_DISTINCT_ID,
    properties: { product: "intervu", surface: "mcp" },
  });
});

test("posthogCaptureUrl prefers an absolute host and falls back for proxy paths", () => {
  assert.equal(
    posthogCaptureUrl("https://eu.i.posthog.com/"),
    "https://eu.i.posthog.com/capture/",
  );
  assert.equal(
    posthogCaptureUrl("/ph"),
    "https://us.i.posthog.com/capture/",
  );
  assert.equal(
    posthogCaptureUrl(undefined),
    "https://us.i.posthog.com/capture/",
  );
});

test("posthogCaptureBody serializes only event metadata, never request input", () => {
  const body = posthogCaptureBody("phc_key", mcpToolCalledCapture("search_jobs", false, "uid-1"));
  const parsed = JSON.parse(body);
  assert.equal(parsed.api_key, "phc_key");
  assert.equal(parsed.event, "mcp_tool_called");
  assert.equal(parsed.distinct_id, "uid-1");
  assert.deepEqual(parsed.properties, {
    product: "intervu",
    surface: "mcp",
    tool: "search_jobs",
    is_error: false,
  });
  assert.equal(Object.keys(parsed).length, 4);
});
