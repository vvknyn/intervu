import { getSavedHandoffClient } from "@/lib/mcp/job-handoff";

const DISMISSED_KEY = "intervu.apply-intent-dismissed";

/**
 * Whether the "hand this role to your AI" prompt should interrupt an apply.
 *
 * The prompt exists because the capability already shipped and nobody finds
 * it: `McpHandoffNote` renders near the bottom of the job detail panel
 * (JobDetail.tsx), below the description, while the Apply button sits in the
 * action row at the top. The one moment the hand-off is worth anything is the
 * moment someone commits to applying, and that is the one moment the control
 * is off screen.
 *
 * Two ways to never see it again, both permanent and both honest:
 *
 * - **You already set it up.** A saved hand-off client means you have paired an
 *   AI and used it at least once, so there is nothing left to nudge you toward.
 *   This is deliberately the same key `McpHandoffActions` writes — deriving the
 *   answer from the thing itself, rather than a second "has seen onboarding"
 *   flag that can disagree with reality.
 * - **You said no.** An explicit dismissal.
 *
 * Storage is read defensively: Safari in private mode throws on localStorage
 * access, and a thrown error here would break the apply click itself. A failure
 * to read resolves to "don't interrupt" — the prompt is an enhancement, and the
 * posting is what the user asked for.
 */
export function shouldPromptApplyIntent(): boolean {
    try {
        if (getSavedHandoffClient()) return false;
        if (typeof localStorage === "undefined") return false;
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
        // reappears next session, which is better than failing the click.
    }
}
