import type { ResumeSummary } from "@/actions/resume-summary";
import type { ResumeData } from "@/types/resume";

/** A résumé to show, plus whether the account also holds a saved copy that needs a paid month to open. */
export type EffectiveResumeSummary = ResumeSummary & { accountCopyLocked?: true };

/**
 * The résumé a signed-in person sees in Settings: the account's stored copy,
 * or, when the account has none to show, the copy kept on this device, as a
 * guest's is. An unpaid account's server answer is "locked" (saved, not
 * readable) or "none"; either way the device copy, when there is one, is what
 * it works from. "locked" with no device copy stays "locked": never "none"
 * over a saved résumé.
 */
export function effectiveResumeSummary(
    server: ResumeSummary,
    local: { data: ResumeData; updatedAt: string } | null,
): EffectiveResumeSummary {
    if ((server.source !== "none" && server.source !== "locked") || !local) return server;
    return {
        source: "resume_data",
        resume_data: local.data,
        updatedAt: local.updatedAt,
        ...(server.source === "locked" ? { accountCopyLocked: true as const } : {}),
    };
}
