/**
 * OAuth 2.1 authorization-server core for the agent/MCP feature (DCR + PKCE
 * authorization-code + refresh rotation). HTTP wiring lives elsewhere; this
 * module is pure store-driven logic so it's unit-testable without a server.
 */
import { randomBytes, createHash } from "node:crypto";
import type { AgentStore } from "./store";
import { issueCredential, verifySecret, revokeCredential } from "./tokens";
import { AGENT } from "./config";

export interface OAuthClient {
    id: string;
    name: string;
    redirectUris: string[];
    createdAt: number;
}

export interface TokenPair {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: "Bearer";
}

/** https: allowed for any host; http: allowed only for localhost/127.0.0.1 (loopback dev). */
function isAllowedRedirectUri(uri: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(uri);
    } catch {
        return false;
    }
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
        return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return false;
}

export async function registerClient(
    store: AgentStore,
    input: { client_name?: string; redirect_uris: string[] }
): Promise<{ client: OAuthClient } | { error: string }> {
    if (input.redirect_uris.length === 0) return { error: "redirect_uris must not be empty" };
    if (!input.redirect_uris.every(isAllowedRedirectUri)) {
        return { error: "redirect_uris must be https:, or http: on localhost/127.0.0.1 only" };
    }
    const id = randomBytes(16).toString("hex");
    const doc = {
        name: input.client_name ?? "Unnamed client",
        redirectUris: input.redirect_uris,
        createdAt: Date.now(),
    };
    await store.set(AGENT.collections.clients, id, doc);
    return { client: { id, ...doc } };
}

export async function getClient(store: AgentStore, id: string): Promise<OAuthClient | null> {
    const doc = await store.get(AGENT.collections.clients, id);
    if (!doc) return null;
    return { id, name: doc.name as string, redirectUris: doc.redirectUris as string[], createdAt: doc.createdAt as number };
}

export async function createAuthCode(
    store: AgentStore,
    opts: { uid: string; clientId: string; redirectUri: string; codeChallenge: string }
): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const createdAt = Date.now();
    await store.set(AGENT.collections.codes, code, {
        uid: opts.uid,
        clientId: opts.clientId,
        redirectUri: opts.redirectUri,
        codeChallenge: opts.codeChallenge,
        createdAt,
        expiresAt: createdAt + AGENT.CODE_TTL_MS,
        used: false,
    });
    return code;
}

async function issueTokenPair(store: AgentStore, uid: string, client: OAuthClient): Promise<TokenPair> {
    const [access, refresh] = await Promise.all([
        issueCredential(store, { uid, kind: "access", clientId: client.id, clientName: client.name }),
        issueCredential(store, { uid, kind: "refresh", clientId: client.id, clientName: client.name }),
    ]);
    return {
        access_token: access.secret,
        refresh_token: refresh.secret,
        expires_in: Math.floor(AGENT.ACCESS_TTL_MS / 1000),
        token_type: "Bearer" as const,
    };
}

export async function exchangeCode(
    store: AgentStore,
    opts: { code: string; clientId: string; redirectUri: string; codeVerifier: string }
): Promise<TokenPair | { error: string }> {
    const doc = await store.get(AGENT.collections.codes, opts.code);
    if (!doc) return { error: "invalid_grant: unknown code" };
    if (doc.used) return { error: "invalid_grant: code already used" };
    if ((doc.expiresAt as number) <= Date.now()) return { error: "invalid_grant: code expired" };
    if (doc.clientId !== opts.clientId) return { error: "invalid_grant: client mismatch" };
    if (doc.redirectUri !== opts.redirectUri) return { error: "invalid_grant: redirect_uri mismatch" };

    const expectedChallenge = createHash("sha256").update(opts.codeVerifier).digest("base64url");
    if (expectedChallenge !== doc.codeChallenge) return { error: "invalid_grant: code_verifier mismatch" };

    // Mark used before issuing tokens so a concurrent second exchange can't win the race.
    await store.update(AGENT.collections.codes, opts.code, { used: true });

    const client = await getClient(store, opts.clientId);
    if (!client) return { error: "invalid_client: unknown client" };
    return issueTokenPair(store, doc.uid as string, client);
}

export async function refreshAccess(
    store: AgentStore,
    opts: { refreshSecret: string; clientId: string }
): Promise<TokenPair | { error: string }> {
    const credential = await verifySecret(store, opts.refreshSecret);
    if (!credential || credential.kind !== "refresh") return { error: "invalid_grant: not a refresh token" };
    if (credential.clientId !== opts.clientId) return { error: "invalid_grant: client mismatch" };

    const client = await getClient(store, opts.clientId);
    if (!client) return { error: "invalid_client: unknown client" };

    await revokeCredential(store, credential.uid, credential.id);
    return issueTokenPair(store, credential.uid, client);
}
