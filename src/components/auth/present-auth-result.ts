import type { VerifyStep } from "@/lib/auth/workos-errors";

/** What an auth server action can answer besides success: a failure to correct, or news to pass on. */
export type AuthActionOutcome =
    | { error: string }
    | VerifyStep
    | { notice: string; kind: "success" | "info" }
    | { success: true };

export type AuthPresentation =
    | { inline: string }
    | { step: "verify"; pendingAuthenticationToken: string; email: string }
    | { toast: { kind: "success" | "info"; text: string }; switchTab?: "login"; prefill?: { username: string } }
    | { ok: true };

/**
 * Where an auth answer goes. A failure stays inline, because the person must
 * fix the form and a toast would vanish first. A held-for-code answer opens
 * the code step in place of the tabs. A notice is not a failure, so
 * it is a toast, and it also carries the next step: the account exists, so
 * the login tab opens with the typed username already in place.
 */
export function presentAuthResult(result: AuthActionOutcome, typed: { username: string }): AuthPresentation {
    if ("error" in result) return { inline: result.error };
    if ("verify" in result) return { step: "verify", ...result.verify };
    if ("notice" in result) {
        return {
            toast: { kind: result.kind, text: result.notice },
            switchTab: "login",
            prefill: { username: typed.username },
        };
    }
    return { ok: true };
}
