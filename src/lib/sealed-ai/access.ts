/**
 * Who may use sealed AI: a signed-in account with a paid month (P2). The
 * request body is encrypted to the enclave, so the pass-through can't tell
 * what it carries; the account is the only thing it can check. Server code
 * only. Both the pass-through (402/401) and `/api/sealed-ai/status`
 * (`enabled: false`, so the four UI consumers fall back with no UI change)
 * ask here, so they can't disagree.
 */
import { hasPaidAccess } from "@/lib/billing/access";
import { getServerUser } from "@/lib/auth/server-user";

export type SealedAiAccess = "ok" | "signed-out" | "unpaid";

type Deps = { uid: () => Promise<string | null>; isPaid: (uid: string) => Promise<boolean> };

const REAL: Deps = { uid: async () => (await getServerUser())?.uid ?? null, isPaid: hasPaidAccess };
let deps: Deps = REAL;

export async function sealedAiAccess(): Promise<SealedAiAccess> {
    const uid = await deps.uid();
    if (!uid) return "signed-out";
    return (await deps.isPaid(uid)) ? "ok" : "unpaid";
}

/** Tests stand in for the session and the profile store; no argument restores them. */
export function useSealedAiAccessDeps(stand?: Partial<Deps>): void {
    deps = stand ? { ...REAL, ...stand } : REAL;
}
