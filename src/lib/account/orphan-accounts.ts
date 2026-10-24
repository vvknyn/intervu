/**
 * Orphan accounts: a profile whose owner has no WorkOS user, so nobody can
 * sign in to it, close it or recover it. Shared by the erase script
 * (scripts/erase-orphan-accounts.ts) and the daily report-only route
 * (api/ops/orphan-accounts).
 *
 * Finding candidates is a set difference, which is only as good as the WorkOS
 * listing, so it may NOT decide a deletion: an empty or partial listing makes
 * every account look orphaned. Erasing re-proves each uid on its own
 * (`assertAllOrphans`) and aborts the whole run on anything but a clean 404.
 */
import { createHash } from "node:crypto";

import type { User } from "@workos-inc/node";

import { getAdminDb } from "@/lib/firebase/admin";
import { isWorkosNotFound } from "@/lib/auth/workos-errors";
import type { WorkosUserManagement } from "@/lib/auth/workos-runtime";
import { isCredentialActive, listCredentials, revokeCredential } from "@/lib/agent/tokens";
import { AGENT } from "@/lib/agent/config";
import type { AgentStore } from "@/lib/agent/store";

/** What is safe to print about a uid: the first 8 hex of its sha256, never the uid itself. */
export const uidLabel = (uid: string): string => createHash("sha256").update(uid).digest("hex").slice(0, 8);

export interface OrphanSources {
    profileUids(): Promise<string[]>;
    /** Owners of agent credentials; a credential can outlive its profile. */
    credentialUids(): Promise<string[]>;
    /** Every id a profile uid could equal: each WorkOS user's id and external_id. */
    workosIds(): Promise<Set<string>>;
}

/** Profile and credential-owner uids that match no WorkOS user by id or external_id (sorted). Throws on a listing that cannot be right. */
export async function findOrphanUids(sources: OrphanSources): Promise<string[]> {
    const [profiles, owners, known] = await Promise.all([sources.profileUids(), sources.credentialUids(), sources.workosIds()]);
    const candidates = new Set([...profiles, ...owners]);
    if (candidates.size > 0 && known.size === 0) {
        throw new Error("WorkOS listing is empty while accounts exist; refusing to call every account an orphan");
    }
    return [...candidates].filter((uid) => !known.has(uid)).sort();
}

/** The real sources. Lists every WorkOS user, not just this product's, so an untagged user is never called an orphan. */
export function realOrphanSources(userManagement: Pick<WorkosUserManagement, "listUsers">, store: AgentStore): OrphanSources {
    return {
        credentialUids: async () => [...new Set((await store.list(AGENT.collections.credentials)).map((c) => c.uid).filter((u): u is string => typeof u === "string" && u.length > 0))],
        profileUids: async () => (await getAdminDb().collection("profiles").select().get()).docs.map((d) => d.id),
        async workosIds() {
            const users: User[] = await (await userManagement.listUsers({ order: "asc" })).autoPagination();
            return new Set(users.flatMap((u) => [u.id, ...(u.externalId ? [u.externalId] : [])]));
        },
    };
}

export interface WorkosLookup {
    getUser(id: string): Promise<unknown>;
    getUserByExternalId(externalId: string): Promise<unknown>;
}

const isAbsent = async (lookup: () => Promise<unknown>): Promise<boolean> => {
    try {
        await lookup();
        return false;
    } catch (error) {
        if (isWorkosNotFound(error)) return true;
        throw new Error(`WorkOS lookup failed (status ${(error as { status?: unknown } | null)?.status ?? "unknown"})`);
    }
};

/** True only when WorkOS answers 404 to BOTH GET users/{uid} and GET users/external_id/{uid}; a 200 is false; any other answer throws. */
export async function proveOrphan(lookup: WorkosLookup, uid: string): Promise<boolean> {
    return (await isAbsent(() => lookup.getUser(uid))) && (await isAbsent(() => lookup.getUserByExternalId(uid)));
}

/** The WorkOS SDK puts ids into the request path raw, so only plain id characters may reach it. */
export const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;

/** Proves every uid, one by one, before any write. Throws on the first uid that is malformed or not a proven orphan. */
export async function assertAllOrphans(lookup: WorkosLookup, uids: readonly string[]): Promise<void> {
    for (const uid of uids) {
        if (!SAFE_UID.test(uid)) throw new Error(`aborting, no writes made: ${uidLabel(uid)} is not a plain id`);
        let orphan: boolean;
        try {
            orphan = await proveOrphan(lookup, uid);
        } catch (error) {
            throw new Error(`aborting, no writes made: ${uidLabel(uid)}: ${(error as Error).message}`);
        }
        if (!orphan) throw new Error(`aborting, no writes made: ${uidLabel(uid)} exists in WorkOS`);
    }
}

const activeCredentialsOf = async (store: AgentStore, uid: string) =>
    (await listCredentials(store, uid)).filter((c) => isCredentialActive(c));

/** Revokes every active agent credential of a uid through `revokeCredential`; returns the real count. */
export async function revokeActiveCredentials(store: AgentStore, uid: string): Promise<number> {
    const active = await activeCredentialsOf(store, uid);
    const outcomes = await Promise.all(active.map((c) => revokeCredential(store, uid, c.id)));
    return outcomes.filter(Boolean).length;
}

export interface OrphanReport {
    /** What the scan looked at, so a count of zero over an empty read is visible as such. */
    profiles: number;
    /** WorkOS ids known (each user's id and external_id), so >= the user count; 0 means the listing was empty. */
    workosUsers: number;
    orphans: number;
    withActiveCredentials: number;
}

/** Counts only. Rejects if either read fails: an error is never reported as zero. */
export async function scanOrphans(sources: OrphanSources, store: AgentStore): Promise<OrphanReport> {
    const [profiles, known] = await Promise.all([sources.profileUids(), sources.workosIds()]);
    const uids = await findOrphanUids({ ...sources, profileUids: async () => profiles, workosIds: async () => known });
    const active = await Promise.all(uids.map(async (uid) => (await activeCredentialsOf(store, uid)).length > 0));
    return { profiles: profiles.length, workosUsers: known.size, orphans: uids.length, withActiveCredentials: active.filter(Boolean).length };
}
