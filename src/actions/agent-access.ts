"use server";

import { getAgentStore } from "@/lib/agent/store";
import {
    issueCredential,
    revokeCredential,
    revokeByClient,
    listCredentials,
    toActiveCredentialSummaries,
    type CredentialSummary,
    type CredentialSummaryKind,
} from "@/lib/agent/tokens";
import { AGENT, trimAndCapLabel } from "@/lib/agent/config";
import { getServerUser } from "@/lib/auth/server-user";

export type { CredentialSummary as AgentCredentialSummary } from "@/lib/agent/tokens";

export async function listAgentCredentialsAction(): Promise<{ data?: CredentialSummary[]; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const rows = await listCredentials(getAgentStore(), user.uid);
    return { data: toActiveCredentialSummaries(rows) };
}

/** Mints a long-lived manual token. The plaintext secret is returned to the
 *  caller exactly once here — it is never stored anywhere but the hash.
 *  `label` is the user's own name for this token ("Laptop Claude Code") so
 *  Settings can tell multiple manual tokens apart later — it's the same
 *  concern `clientName` already carries for OAuth clients (see
 *  `toActiveCredentialSummaries`), so it's stored there rather than as a new
 *  field; trimmed/capped/blank-to-`undefined` by the same `trimAndCapLabel`
 *  DCR's `client_name` uses. */
export async function createManualTokenAction(label?: string): Promise<{ secret?: string; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const clientName = trimAndCapLabel(label, AGENT.MAX_TOKEN_LABEL_LENGTH);
    const { secret } = await issueCredential(getAgentStore(), { uid: user.uid, kind: "manual", clientName });
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
            ? await revokeByClient(getAgentStore(), user.uid, id)
            : (await revokeCredential(getAgentStore(), user.uid, id))
              ? 1
              : 0;
    if (revokedCount === 0) return { error: "Credential not found" };
    return { ok: true };
}
