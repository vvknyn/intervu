/**
 * Bearer-token extraction, kept in a zero-I/O module so route handlers can
 * share it without importing each other. Importing it from the MCP route
 * would pull `mcp-handler`, every agent tool and the Firebase Admin SDK into
 * the importing route's module graph.
 */

export function extractBearerToken(request: Request): string | undefined {
    const [type, token] = (request.headers.get("authorization") ?? "").split(" ");
    return type?.toLowerCase() === "bearer" && token ? token : undefined;
}
