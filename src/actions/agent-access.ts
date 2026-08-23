"use server";

import { firestoreStore } from "@/lib/agent/store";
import {
    issueCredential,
    revokeCredential,
    revokeByClient,
    listCredentials,
    toActiveCredentialSummaries,
    type CredentialSummary,
    type CredentialSummaryKind,
} from "@/lib/agent/tokens";
import { getServerUser } from "@/lib/auth/session";

export type { CredentialSummary as AgentCredentialSummary } from "@/lib/agent/tokens";

export async function listAgentCredentialsAction(): Promise<{ data?: CredentialSummary[]; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const rows = await listCredentials(firestoreStore(), user.uid);
    return { data: toActiveCredentialSummaries(rows) };
}

/** Mints a long-lived manual token. The plaintext secret is returned to the
 *  caller exactly once here — it is never stored anywhere but the hash. */
export async function createManualTokenAction(): Promise<{ secret?: string; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const { secret } = await issueCredential(firestoreStore(), { uid: user.uid, kind: "manual" });
    return { secret };
}

/**
 * `id`/`kind` are exactly `toActiveCredentialSummaries`'s row shape (Settings
 * passes the summary straight back): a `manual` row is one credential, so
 * `id` is that credential's own id; an `oauth` row is `id: clientId` (see
 * that function's doc comment), so disconnecting it has to revoke every row
 * under that client — `revokeByClient`, not `revokeCredential` — or the
 * sibling access/refresh row silently survives (CRITICAL 2 review fix).
 */
export async function revokeAgentCredentialAction(
    id: string,
    kind: CredentialSummaryKind
): Promise<{ ok?: boolean; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const revokedCount =
        kind === "oauth"
            ? await revokeByClient(firestoreStore(), user.uid, id)
            : (await revokeCredential(firestoreStore(), user.uid, id))
              ? 1
              : 0;
    if (revokedCount === 0) return { error: "Credential not found" };
    return { ok: true };
}
