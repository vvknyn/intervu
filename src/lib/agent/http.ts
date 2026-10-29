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

/**
 * The client id an OAuth client sent as `Authorization: Basic base64(id:secret)`
 * (RFC 6749 §2.3.1 `client_secret_basic`) — how a client that asked for that
 * auth method at registration presents itself at the token endpoint, with no
 * `client_id` in the body. Every client here is public (PKCE is the proof and
 * no secret is ever issued), so only the id is read; any secret is ignored.
 * Both halves are form-urlencoded before the base64, per the RFC.
 */
export function extractBasicClientId(request: Request): string | undefined {
    const [type, encoded] = (request.headers.get("authorization") ?? "").split(" ");
    if (type?.toLowerCase() !== "basic" || !encoded) return undefined;
    try {
        const credentials = atob(encoded);
        const colon = credentials.indexOf(":");
        const id = colon === -1 ? credentials : credentials.slice(0, colon);
        return decodeURIComponent(id.replace(/\+/g, " ")) || undefined;
    } catch {
        return undefined;
    }
}
