import { NextResponse } from "next/server";
import { AGENT } from "@/lib/agent/config";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 AS metadata.
 * MCP clients fetch this to discover our OAuth endpoints before DCR.
 */
export async function GET() {
    const issuer = AGENT.issuer();
    return NextResponse.json(
        {
            issuer,
            authorization_endpoint: `${issuer}/oauth/authorize`,
            token_endpoint: `${issuer}/api/oauth/token`,
            registration_endpoint: `${issuer}/api/oauth/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
        },
        { headers: { "Cache-Control": "public, max-age=3600" } }
    );
}
