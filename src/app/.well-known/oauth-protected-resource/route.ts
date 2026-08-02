import { protectedResourceMetadataResponse } from "@/lib/agent/config";

/**
 * GET /.well-known/oauth-protected-resource — RFC 9728 protected-resource
 * metadata, pointing MCP clients at the AS that guards /api/mcp.
 */
export async function GET() {
    return protectedResourceMetadataResponse();
}
