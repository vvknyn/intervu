import { protectedResourceMetadataResponse } from "@/lib/agent/config";

/**
 * GET /.well-known/oauth-protected-resource/<anything> — RFC 9728 §3.1 lets a
 * client construct the metadata URL by inserting the protected resource's own
 * path into `/.well-known/oauth-protected-resource<path>` (e.g.
 * `/.well-known/oauth-protected-resource/api/mcp` for a resource at
 * `/api/mcp`), not just the bare well-known path. Without this catch-all,
 * that request 404s and such a client can never discover the AS. The answer
 * is identical to the bare route either way — the metadata document doesn't
 * vary by which path form reached it — so both share the ONE response
 * builder (IMPORTANT 5 review fix).
 */
export async function GET() {
    return protectedResourceMetadataResponse();
}
