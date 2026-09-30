import { hasResumeContent } from "@/lib/resume/has-content";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import type { ResumeData } from "@/types/resume";

/**
 * The structured résumé a profile doc stands for. A résumé uploaded as a
 * file on /resume or Settings, or sent as text through the MCP set_resume
 * tool, is stored as `resume_text` only (set-resume.ts deletes
 * `resume_data` so a stale structured copy can't shadow the new text).
 * Every matching surface reads structured data, so without this those
 * users were matched as if they had no résumé at all. The text is
 * structured with the same rules the browser import and the PDF export use.
 */
export function storedResumeData(resumeData: ResumeData | undefined, resumeText: unknown): ResumeData | undefined {
    if (resumeData && hasResumeContent(resumeData)) return resumeData;
    if (typeof resumeText === "string" && resumeText.trim()) return resumeDataFromPlainText(resumeText);
    return resumeData;
}
