/** What an auth server action can answer besides success: a failure to correct, or news to pass on. */
export type AuthActionOutcome =
    | { error: string }
    | { notice: string; kind: "success" | "info" }
    | { success: true };

export type AuthPresentation =
    | { inline: string }
    | { toast: { kind: "success" | "info"; text: string }; switchTab?: "login"; prefill?: { username: string } }
    | { ok: true };

/**
 * Where an auth answer goes. A failure stays inline, because the person must
 * fix the form and a toast would vanish first. A notice is not a failure, so
 * it is a toast, and it also carries the next step: the account exists, so
 * the login tab opens with the typed username already in place.
 */
export function presentAuthResult(result: AuthActionOutcome, typed: { username: string }): AuthPresentation {
    if ("error" in result) return { inline: result.error };
    if ("notice" in result) {
        return {
            toast: { kind: result.kind, text: result.notice },
            switchTab: "login",
            prefill: { username: typed.username },
        };
    }
    return { ok: true };
}
