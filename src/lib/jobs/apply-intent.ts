import { getSavedHandoffClient } from "@/lib/mcp/job-handoff";

const DISMISSED_KEY = "intervu.apply-intent-dismissed";
/** Opt-in only. Default OFF so Apply opens the posting directly. */
const ENABLED_KEY = "intervu.apply-intent-enabled";

/**
 * Whether the "hand this role to your AI" (BYO Claude/ChatGPT) prompt should
 * interrupt an apply.
 *
 * Product default is OFF — Apply opens the employer posting immediately.
 * The hand-off still lives on the job detail panel (`McpHandoffNote`); this
 * interrupt only returns when explicitly opted in via
 * `intervu.apply-intent-enabled=1`, and even then stays silent if the user
 * already paired an AI or dismissed the prompt.
 *
 * Storage is read defensively: Safari in private mode throws on localStorage
 * access, and a thrown error here would break the apply click itself. A failure
 * to read resolves to "don't interrupt" — the posting is what the user asked for.
 */
export function shouldPromptApplyIntent(): boolean {
    try {
        if (typeof localStorage === "undefined") return false;
        // Default off — posting first.
        if (localStorage.getItem(ENABLED_KEY) !== "1") return false;
        if (getSavedHandoffClient()) return false;
        return localStorage.getItem(DISMISSED_KEY) !== "1";
    } catch {
        return false;
    }
}

export function dismissApplyIntent(): void {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
        // Nothing to do — a dismissal that cannot persist just means the prompt
        // reappears next session (only if re-enabled), which is better than failing the click.
    }
}
