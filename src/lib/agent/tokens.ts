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

/** True when a credential can still authenticate — not revoked, not past its TTL.
 *  The one place this decision is made; verification and any listing that
 *  means "currently connected" both read it instead of re-deriving it. */
export function isCredentialActive(c: Pick<Credential, "revokedAt" | "expiresAt">, now = Date.now()): boolean {
    if (c.revokedAt != null) return false;
    if (c.expiresAt != null && c.expiresAt <= now) return false;
    return true;
}

/** The kinds that may authorize a call to a protected resource. A refresh
 *  credential exists solely to mint access tokens and must never stand in for
 *  one, so it is absent by construction. Lives here beside `CredentialKind`
 *  rather than in any one route, because every bearer-authenticated route
 *  applies the same rule and a second copy is a second thing to get wrong. */
export const AUTHORIZED_CREDENTIAL_KINDS: ReadonlySet<CredentialKind> = new Set(["manual", "access"]);

export async function verifySecret(store: AgentStore, secret: string): Promise<Credential | null> {
    const hash = hashSecret(secret);
    const rows = await store.findByField(AGENT.collections.credentials, "tokenHash", hash);
    if (rows.length === 0) return null;
    const { id, ...doc } = rows[0];
    const credential = toCredential(id, doc);
    if (!isCredentialActive(credential)) return null;
    store.update(AGENT.collections.credentials, id, { lastUsedAt: Date.now() }).catch(() => {});
    return credential;
}

export async function revokeCredential(store: AgentStore, uid: string, id: string): Promise<boolean> {
    const doc = await store.get(AGENT.collections.credentials, id);
    if (!doc || doc.uid !== uid) return false;
    await store.update(AGENT.collections.credentials, id, { revokedAt: Date.now() });
    return true;
}

/**
 * Revokes every active credential sharing `uid` + `clientId` — one OAuth
 * "connection" is an access row AND a refresh row (`issueTokenPair`,
 * oauth.ts), and every refresh rotation (`refreshAccess`) mints a fresh pair
 * under that SAME `clientId`, so revoking a single row (as the settings UI
 * used to) always left a sibling alive to silently re-mint access. This is
 * the one place "disconnect this app" is carried out, for however many rows
 * that turns out to be. Reuses `revokeCredential` per row (same ownership
 * check, same single write path) rather than a parallel bulk-update — the
 * real count revoked is returned, never guessed. Ownership-scoped exactly
 * like `revokeCredential`: a `uid` that owns none of the matching rows
 * revokes zero.
 */
export async function revokeByClient(store: AgentStore, uid: string, clientId: string): Promise<number> {
    const rows = await listCredentials(store, uid);
    const targets = rows.filter((c) => c.clientId === clientId && isCredentialActive(c));
    const outcomes = await Promise.all(targets.map((c) => revokeCredential(store, uid, c.id)));
    return outcomes.filter(Boolean).length;
}

export async function listCredentials(store: AgentStore, uid: string): Promise<Omit<Credential, "tokenHash">[]> {
    const rows = await store.findByField(AGENT.collections.credentials, "uid", uid);
    return rows.map(({ id, ...doc }) => {
        const { tokenHash: _tokenHash, ...rest } = toCredential(id, doc);
        return rest;
    });
}

/** The UI-facing kind: a manual token is always its own row; every OAuth
 *  credential kind ("access"/"refresh") collapses to one "oauth" row per
 *  client (see `toActiveCredentialSummaries`) — the storage-level distinction
 *  between an access and a refresh row is never a UI concern. */
export type CredentialSummaryKind = "manual" | "oauth";

/** The wire-safe shape a UI is allowed to show for one CONNECTION — never a
 *  `tokenHash`, `uid`, or `clientId`, even though callers already pass the
 *  hash-stripped type; this is the one place that decides the public
 *  projection, so a future field added to `Credential` can't leak here by
 *  accident. For `kind: "oauth"`, `id` is the client id itself — the one
 *  stable key shared by every row (access + refresh, and every row a
 *  refresh rotation subsequently mints) that make up that connection, so a
 *  revoke action can hand it straight to `revokeByClient`. */
export interface CredentialSummary {
    id: string;
    kind: CredentialSummaryKind;
    clientName: string | null;
    createdAt: number;
    lastUsedAt: number | null;
}

/**
 * The "connected agents" view: one row per live CONNECTION, active
 * credentials only. A revoked or expired credential isn't a live connection
 * anymore (this is the same rule `isCredentialActive`/`verifySecret` use to
 * decide whether a secret still authenticates), so it drops out of the list
 * here rather than lingering until some separate cleanup job runs.
 *
 * An OAuth connection is physically TWO rows sharing one `clientId` — an
 * access credential and a refresh credential (`issueTokenPair`, oauth.ts) —
 * and every refresh rotation mints a fresh pair under that same `clientId`.
 * Projecting 1:1 (the pre-fix behavior) showed the user duplicate
 * "connections" and let a "Revoke" click on either row alone leave the
 * other's secret live to silently re-mint access. Grouping by `clientId`
 * here is what makes the list — and downstream, revoke — match what a user
 * actually thinks of as one connected app. A manual token has no client
 * behind it, so it's exempt from grouping and stays one row per credential.
 *
 * Lives here (not in the "use server" actions file that calls it) because a
 * "use server" module may only export async functions — this is a pure,
 * synchronous projection and belongs beside the `Credential` type it reads.
 */
export function toActiveCredentialSummaries(
    rows: Omit<Credential, "tokenHash">[],
    now: number = Date.now()
): CredentialSummary[] {
    const active = rows.filter((c) => isCredentialActive(c, now));

    const manual: CredentialSummary[] = active
        .filter((c) => c.kind === "manual")
        .map(({ id, clientName, createdAt, lastUsedAt }) => ({ id, kind: "manual" as const, clientName, createdAt, lastUsedAt }));

    const byClient = new Map<string, Omit<Credential, "tokenHash">[]>();
    for (const c of active) {
        if (c.kind === "manual" || !c.clientId) continue;
        byClient.set(c.clientId, [...(byClient.get(c.clientId) ?? []), c]);
    }
    const oauth: CredentialSummary[] = Array.from(byClient.entries()).map(([clientId, group]) => {
        const lastUsedTimestamps = group.map((c) => c.lastUsedAt).filter((t): t is number => t != null);
        return {
            id: clientId,
            kind: "oauth" as const,
            clientName: group[0].clientName,
            createdAt: Math.min(...group.map((c) => c.createdAt)),
            lastUsedAt: lastUsedTimestamps.length ? Math.max(...lastUsedTimestamps) : null,
        };
    });

    return [...manual, ...oauth];
}
