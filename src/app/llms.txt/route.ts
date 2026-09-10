import { NextResponse } from "next/server";
import { AGENT } from "@/lib/agent/config";
import { getSiteUrl } from "@/lib/seo/constants";
import { MCP_TOOL_SPECS } from "@/lib/agent/mcp-tool-specs";

/**
 * GET /llms.txt — the agent-facing entity card, generated from the SAME
 * `MCP_TOOL_SPECS` catalog (src/lib/agent/mcp-tool-specs.ts) `/api/mcp`
 * registers its tools from (see that catalog's doc comment) rather than
 * hand-maintained prose, so this file can never list a stale tool set or a
 * retired param again. Dynamic by default
 * (no `revalidate`) — same shape as the sibling
 * `/.well-known/oauth-protected-resource` route — since `AGENT.issuer()`
 * and `getSiteUrl()` are both read from env per request.
 */
export async function GET() {
    const issuer = AGENT.issuer();
    const siteUrl = getSiteUrl();

    const tools = Object.entries(MCP_TOOL_SPECS)
        .map(([name, spec]) => {
            const params = Object.keys(spec.inputSchema.shape);
            return `- ${name} — ${spec.title}. ${spec.description} Params: ${params.length > 0 ? params.join(", ") : "none"}`;
        })
        .join("\n");

    const body = `# velai

velai is a job search platform that verifies listings are real (filtering out ghost jobs) and tracks your applications — this file describes velai's agent integration for AI agents and the humans configuring them.

## MCP endpoint

${issuer}/api/mcp

## Authentication

Two ways in:
- OAuth (for chat apps with remote-connector support): discover the authorization server via ${issuer}/.well-known/oauth-protected-resource, then register and connect through the standard MCP OAuth flow.
- Manual token (for Claude Code and other CLIs): generate one at ${siteUrl}/settings under "Connected agents" — name it so you can revoke it later — then send it as \`Authorization: Bearer <token>\`.

## Limits

Per credential: ${AGENT.RATE_LIMIT} calls/hour, up to ${AGENT.RESULT_CAP} results per search_jobs page (default 10), up to ${AGENT.SEARCH_DEPTH_CAP} results per query via cursor pagination, a ${AGENT.DAILY_RECORD_BUDGET}-record daily budget shared by search_jobs and get_job, and a ${AGENT.DAILY_COMPANY_READ_BUDGET}-call daily budget shared by the company tools (each of those says so in its own description). Exceeding a rate limit returns HTTP 429 with a Retry-After header; a bad, expired, or revoked token returns HTTP 401.

## Tools

${tools}

## What this does not do

velai never submits applications for you. Your agent runs on your side; velai supplies verified job targets and keeps your tracker true.

## Learn more

${siteUrl}/connect
`;

    return new NextResponse(body, {
        status: 200,
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
        },
    });
}
