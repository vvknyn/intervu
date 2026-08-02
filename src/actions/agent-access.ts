"use server";

import { firestoreStore } from "@/lib/agent/store";
import {
    issueCredential,
    revokeCredential,
    listCredentials,
    toActiveCredentialSummaries,
    type CredentialSummary,
} from "@/lib/agent/tokens";
import { getServerUser } from "@/lib/firebase/auth-session";

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

export async function revokeAgentCredentialAction(id: string): Promise<{ ok?: boolean; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    const revoked = await revokeCredential(firestoreStore(), user.uid, id);
    if (!revoked) return { error: "Credential not found" };
    return { ok: true };
}
