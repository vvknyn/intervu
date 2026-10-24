import type { ResumeSummary } from "@/actions/resume-summary";
import type { ResumeData } from "@/types/resume";

/**
 * The résumé a signed-in person sees in Settings: the account's stored copy,
 * or, when the account holds none (it answers "none" to an unpaid account),
 * the copy kept on this device, as a guest's is. Never "none" while a device
 * copy exists.
 */
export function effectiveResumeSummary(
    server: ResumeSummary,
    local: { data: ResumeData; updatedAt: string } | null,
): ResumeSummary {
    if (server.source !== "none" || !local) return server;
    return { source: "resume_data", resume_data: local.data, updatedAt: local.updatedAt };
}
