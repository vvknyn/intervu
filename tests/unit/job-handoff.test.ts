import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHandoffUrl, buildJobMcpHandoffPrompt } from "../../src/lib/mcp/job-handoff";

const FIXTURE = {
    id: "job-abc123",
    title: "Senior Engineer",
    company: "Acme Corp",
    location: "San Francisco, CA",
};

describe("buildJobMcpHandoffPrompt", () => {
    it("includes job_id and MCP-oriented ask", () => {
        const prompt = buildJobMcpHandoffPrompt(FIXTURE);
        assert.match(prompt, /job_id job-abc123/);
        assert.match(prompt, /intervu MCP/);
        assert.match(prompt, /fit/);
        assert.ok(prompt.length < 500);
    });

    it("omits location when absent", () => {
        const prompt = buildJobMcpHandoffPrompt({ ...FIXTURE, location: null });
        assert.match(prompt, /"Senior Engineer" at Acme Corp\)/);
        assert.doesNotMatch(prompt, /San Francisco/);
    });
});

describe("buildHandoffUrl", () => {
    it("builds claude.ai/new with encoded prompt", () => {
        const url = buildHandoffUrl("claude", FIXTURE);
        assert.ok(url.startsWith("https://claude.ai/new?q="));
        const q = decodeURIComponent(url.slice("https://claude.ai/new?q=".length));
        assert.equal(q, buildJobMcpHandoffPrompt(FIXTURE));
    });

    it("builds chatgpt.com with encoded prompt", () => {
        const url = buildHandoffUrl("chatgpt", FIXTURE);
        assert.ok(url.startsWith("https://chatgpt.com/?q="));
        const q = decodeURIComponent(url.slice("https://chatgpt.com/?q=".length));
        assert.equal(q, buildJobMcpHandoffPrompt(FIXTURE));
    });
});
