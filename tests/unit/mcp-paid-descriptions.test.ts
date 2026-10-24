import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_TOOL_SPECS, PAID_MONTH_NOTE } from "../../src/lib/agent/mcp-tool-specs";

/** The tools the MCP route gates on a paid month, read off its `needsPaid` handlers. */
const gated = new Set(
    [...readFileSync("src/app/api/mcp/route.ts", "utf8").matchAll(/^\s+(\w+): withDeps\("\w+",[^\n]*needsPaid: true/gm)].map((m) => m[1]),
);

test("the route gates a set of tools, including résumé tools other than the one that surfaced this", () => {
    assert.ok(gated.size >= 8);
    for (const name of ["get_resume", "set_resume", "draft_screening_answer", "daily_picks"]) assert.ok(gated.has(name), name);
});

test("a tool's description says it needs a paid month exactly when the server gates it", () => {
    for (const [name, spec] of Object.entries(MCP_TOOL_SPECS)) {
        assert.equal(spec.description.startsWith(PAID_MONTH_NOTE), gated.has(name), `${name}: description vs needsPaid`);
    }
});
