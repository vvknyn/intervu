import type { AgentPreferences } from "@/actions/agent-preferences";

/**
 * Where the saved-preferences read stands. A consumer cannot reach `prefs` without first narrowing past `pending`
 * and `failed`, so a control that renders or writes from it cannot treat "not read yet" or "never answered" as
 * "nothing saved" (the languages row showed the résumé's language, and a save in that window replaced the saved one).
 * `prefs` is null only for a signed-out visitor, who has none.
 */
export type AgentPreferencesRead = { status: "pending" } | { status: "failed" } | { status: "ready"; prefs: AgentPreferences | null };

/** What the shared copy holds: the account it was read for, its preferences, and whether the read never answered. */
export interface HeldPreferences {
    uid: string;
    prefs: AgentPreferences | null;
    failed?: true;
}

export function agentPreferencesRead(held: HeldPreferences | null, uid: string | null): AgentPreferencesRead {
    if (!uid) return { status: "ready", prefs: null };
    if (held?.uid !== uid) return { status: "pending" };
    return held.failed ? { status: "failed" } : { status: "ready", prefs: held.prefs };
}

/**
 * The preferences for a fit label or a ranking, which can be recomputed when they arrive. Read-only use: a control
 * that writes must narrow on `status` instead, because this stands in "none" for a read that has not answered.
 */
export function scoringPreferences(read: AgentPreferencesRead): AgentPreferences | null {
    return read.status === "ready" ? read.prefs : null;
}
