/**
 * Hashed, revocable credentials for the agent/MCP feature.
 *
 * Secrets are never stored — only a sha256 hash of the secret is persisted,
 * so a store read/leak cannot be used to authenticate. Three kinds share one
 * collection and one verification path: manual (long-lived PAT-style),
 * access (short-lived OAuth access token), refresh (OAuth refresh token).
 */
import { randomBytes, createHash } from "node:crypto";
import type { AgentStore } from "./store";
import { AGENT } from "./config";

export type CredentialKind = "manual" | "access" | "refresh";

export interface Credential {
    id: string;
    uid: string;
    kind: CredentialKind;
    clientId: string | null;
    clientName: string | null;
    tokenHash: string;
    createdAt: number;
    expiresAt: number | null;
    revokedAt: number | null;
    lastUsedAt: number | null;
}

const SECRET_PREFIX: Record<CredentialKind, string> = {
    manual: "ivu_",
    access: "iva_",
    refresh: "ivr_",
};

/** Default TTL per kind when the caller doesn't pass one; only access tokens expire by default. */
const DEFAULT_TTL_MS: Record<CredentialKind, number | null> = {
    manual: null,
    access: AGENT.ACCESS_TTL_MS,
    refresh: null,
};

export function hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
}

function toCredential(id: string, doc: Record<string, unknown>): Credential {
    return {
        id,
        uid: doc.uid as string,
        kind: doc.kind as CredentialKind,
        clientId: (doc.clientId as string | null) ?? null,
        clientName: (doc.clientName as string | null) ?? null,
        tokenHash: doc.tokenHash as string,
        createdAt: doc.createdAt as number,
        expiresAt: (doc.expiresAt as number | null) ?? null,
        revokedAt: (doc.revokedAt as number | null) ?? null,
        lastUsedAt: (doc.lastUsedAt as number | null) ?? null,
    };
}

export async function issueCredential(
    store: AgentStore,
    opts: { uid: string; kind: CredentialKind; clientId?: string; clientName?: string; ttlMs?: number | null }
): Promise<{ credential: Credential; secret: string }> {
    const secret = `${SECRET_PREFIX[opts.kind]}${randomBytes(36).toString("base64url")}`;
    const id = randomBytes(16).toString("hex");
    const createdAt = Date.now();
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS[opts.kind];
    const doc: Record<string, unknown> = {
        uid: opts.uid,
        kind: opts.kind,
        clientId: opts.clientId ?? null,
        clientName: opts.clientName ?? null,
        tokenHash: hashSecret(secret),
        createdAt,
        expiresAt: ttlMs == null ? null : createdAt + ttlMs,
        revokedAt: null,
        lastUsedAt: null,
    };
    await store.set(AGENT.collections.credentials, id, doc);
    return { credential: toCredential(id, doc), secret };
}

export async function verifySecret(store: AgentStore, secret: string): Promise<Credential | null> {
    const hash = hashSecret(secret);
    const rows = await store.findByField(AGENT.collections.credentials, "tokenHash", hash);
    if (rows.length === 0) return null;
    const { id, ...doc } = rows[0];
    const credential = toCredential(id, doc);
    if (credential.revokedAt != null) return null;
    if (credential.expiresAt != null && credential.expiresAt <= Date.now()) return null;
    store.update(AGENT.collections.credentials, id, { lastUsedAt: Date.now() }).catch(() => {});
    return credential;
}

export async function revokeCredential(store: AgentStore, uid: string, id: string): Promise<boolean> {
    const doc = await store.get(AGENT.collections.credentials, id);
    if (!doc || doc.uid !== uid) return false;
    await store.update(AGENT.collections.credentials, id, { revokedAt: Date.now() });
    return true;
}

export async function listCredentials(store: AgentStore, uid: string): Promise<Omit<Credential, "tokenHash">[]> {
    const rows = await store.findByField(AGENT.collections.credentials, "uid", uid);
    return rows.map(({ id, ...doc }) => {
        const { tokenHash: _tokenHash, ...rest } = toCredential(id, doc);
        return rest;
    });
}
