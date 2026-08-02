import { NextResponse } from "next/server";
import { AGENT } from "@/lib/agent/config";

/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 protected-resource
 * metadata, pointing MCP clients at the AS that guards /api/mcp.
 */
export async function GET() {
    const issuer = AGENT.issuer();
    return NextResponse.json(
        {
            resource: `${issuer}/api/mcp`,
            authorization_servers: [issuer],
        },
        { headers: { "Cache-Control": "public, max-age=3600" } }
    );
}
