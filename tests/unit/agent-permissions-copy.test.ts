import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOL_SPECS } from "../../src/lib/agent/mcp-tool-specs";
import { AGENT_PERMISSIONS, AGENT_PERMISSIONS_LIMITS } from "../../src/lib/agent/permissions-copy";

/**
 * The consent card and /connect say what a connected AI can do before anyone
 * connects one. Every MCP tool must sit under one of those lines, so the page
 * can't claim less access than the tools give.
 */

test("every MCP tool is covered by a permission line, and every listed tool exists", () => {
    const listed = AGENT_PERMISSIONS.flatMap((p) => p.tools);
    const tools = Object.keys(MCP_TOOL_SPECS);
    assert.deepEqual(tools.filter((t) => !listed.includes(t as never)), [], "tools with no permission line");
    assert.deepEqual(listed.filter((t) => !tools.includes(t)), [], "permission lines naming tools that don't exist");
});

test("the copy names the résumé and tracker writes, and claims no read-only access", () => {
    const text = [...AGENT_PERMISSIONS.map((p) => p.text), AGENT_PERMISSIONS_LIMITS].join(" ");
    assert.match(text, /résumé/);
    assert.match(text, /replace/);
    assert.match(text, /mark them applied/);
    assert.doesNotMatch(text, /read-only|cannot read your|can't read your/i);
});

test("the consent card and /connect render the shared list, not their old claims", () => {
    const card = readFileSync(join(__dirname, "../../src/components/oauth/ConsentCards.tsx"), "utf8");
    const connect = readFileSync(join(__dirname, "../../src/app/connect/connect-client.tsx"), "utf8");
    for (const source of [card, connect]) {
        assert.match(source, /AGENT_PERMISSIONS\.map/);
        assert.match(source, /AGENT_PERMISSIONS_LIMITS/);
    }
    assert.doesNotMatch(card, /cannot read your chats, files, or resume/);
    assert.doesNotMatch(connect, /Read-only search/);
    assert.doesNotMatch(connect, /strictly for reading/);
});
