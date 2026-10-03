import { hasResumeContent } from "@/lib/resume/has-content";
import { resumeDataToPlainText } from "@/lib/resume/to-plain-text";
import type { ResumeData } from "@/types/resume";
import { stageRank, type AppliedResume, type Pursuit, type PursuitStage } from "@/lib/pursuits/types";

/**
 * Marking a role Applied copies the résumé on file onto it, so "Resume used"
 * can say what went out (journey audit 2026-09-30: only the MCP tools ever
 * filed one, so the web tracker never knew). The account's résumé for a
 * signed-in person (`actions/application.ts`, `upsert-core.ts`), this
 * device's for a guest (`guest-store.ts`). Removable from the role's page and
 * sheet; deleting the résumé deletes every copy (`set-resume.ts`).
 *
 * Pure: no I/O, safe in client and server code.
 */

/** What a role calls the copy, on its "Resume used" card and in the sheet. */
export const APPLIED_RESUME_LABEL = "Your résumé";

/** The résumé on file as the text a role keeps, or null when there's none. */
export function resumeTextOnFile(resume: { resume_data?: ResumeData | null; resume_text?: string | null } | null | undefined): string | null {
    const data = resume?.resume_data;
    if (data && hasResumeContent(data)) return resumeDataToPlainText(data) || null;
    return resume?.resume_text?.trim() || null;
}

/**
 * Whether a write moving a role from `previous` (null: a new role) to `next`
 * copies the résumé: only the move up into Applied, and only onto a role with
 * no résumé yet. A version filed for the role (a tailored one, from an agent)
 * is what went out, so the base résumé never joins it; a role moved back
 * down and up again keeps the copy it took the first time.
 */
export function attachesResumeOnApply(
    previous: Pick<Pursuit, "status" | "applied_resume" | "resume_versions"> | null,
    next: PursuitStage | undefined,
): boolean {
    if (next !== "applied") return false;
    if (!previous) return true;
    if (stageRank(previous.status) >= stageRank("applied")) return false;
    return !previous.applied_resume && !previous.resume_versions?.length;
}

/** The copy such a write stores, or undefined to leave the role as it is. */
export function appliedResumeFor(
    previous: Pick<Pursuit, "status" | "applied_resume" | "resume_versions"> | null,
    next: PursuitStage | undefined,
    resumeText: string | null,
    nowIso: string,
): AppliedResume | undefined {
    if (!resumeText || !attachesResumeOnApply(previous, next)) return undefined;
    return { saved_at: nowIso, content: resumeText };
}

/** The role as the account's tracker list sends it: the copy's date, not its text. */
export function withoutAppliedResumeText<T extends Pick<Pursuit, "applied_resume">>(pursuit: T): T {
    if (!pursuit.applied_resume) return pursuit;
    return { ...pursuit, applied_resume: { saved_at: pursuit.applied_resume.saved_at } };
}
