import type { ResumeData } from "@/types/resume";

/**
 * Whether /jobs should show a "add your résumé to rank by fit" entry point
 * (the front-door band reads it — see front-door-state.ts).
 *
 * `resumeOnFile` is the SERVER-aware tri-state from `useResumePresence`
 * combined with local state (page.tsx's `resumeOnFile` derivation), not
 * local-only state — a returning signed-in user whose résumé lives on the
 * server must not be told to "add" one just because this session hasn't
 * loaded it yet. `null` (server round trip not back yet) reads as "don't
 * know" rather than "missing": inviting on an unresolved answer would flash
 * the entry for someone who actually has a résumé on file.
 */
export function needsResumeEntry({
    signedIn,
    resumeOnFile,
    fitActive,
}: {
    signedIn: boolean;
    resumeOnFile: boolean | null;
    fitActive: boolean;
}): boolean {
    if (fitActive) return false;
    if (resumeOnFile === true) return false;
    if (resumeOnFile === null) return false;
    if (!signedIn) return true;
    return resumeOnFile === false;
}

/**
 * Whether the toolbar / Sort menu offer "Rank with my résumé": any time the list is not already ranked by fit
 * and presence is known. `true` runs the fit; `false` falls through to the upload path; `null` stays quiet.
 * Separate from `needsResumeEntry` (the "add a résumé" invite), which must stay off for someone who has one.
 */
export function offersRankByFit({ resumeOnFile, fitActive }: { resumeOnFile: boolean | null; fitActive: boolean }): boolean {
    return !fitActive && resumeOnFile !== null;
}

export type JobsResumeEntry = "toolbar" | "sort" | "detail";

/**
 * Every résumé entry point /jobs offers a viewer: the toolbar's "Rank with my résumé", Sort › "Best fit", and
 * the one slot in the job detail's "Why this fits". /resume and Settings are their own pages, not counted. The
 * toolbar and the sort entry read `offersRankByFit`; the detail slot invites only while no résumé is confirmed.
 */
export function jobsResumeEntries({ resumeOnFile, fitActive }: { resumeOnFile: boolean | null; fitActive: boolean }): JobsResumeEntry[] {
    const entries: JobsResumeEntry[] = offersRankByFit({ resumeOnFile, fitActive }) ? ["toolbar", "sort"] : [];
    if (resumeOnFile !== true) entries.push("detail");
    return entries;
}

/** What the strip under the toolbar says it read: the title, then the place; null when it read neither. */
export function resumeReadLine(resume: ResumeData): string | null {
    const title = resume.profile?.profession?.trim() || resume.experience?.find((e) => e.role?.trim())?.role.trim();
    const place = resume.profile?.location?.trim();
    const parts = [title, place].filter(Boolean);
    return parts.length > 0 ? `We read: ${parts.join(" · ")}` : null;
}
