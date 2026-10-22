import { hasResumeContent } from "@/lib/resume/has-content";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import type { ResumeData } from "@/types/resume";

/**
 * The structured résumé a profile doc stands for. A résumé uploaded as a
 * file on /resume or Settings, or sent as text through the MCP set_resume
 * tool, is stored as `resume_text` only (set-resume.ts deletes
 * `resume_data` so a stale structured copy can't shadow the new text).
 * Every matching surface reads structured data, so without this those
 * users were matched as if they had no résumé at all. The text is
 * structured with the same rules the browser import and the PDF export use.
 *
 * Browser only: `fetchResumeData` sends the stored text and each caller
 * structures it here, because résumé parsing never runs on our servers
 * ("Résumé parsing stays on your device", resume-privacy-copy.ts).
 */
export function storedResumeData(resumeData: ResumeData | undefined, resumeText: unknown): ResumeData | undefined {
    if (resumeData && hasResumeContent(resumeData)) return resumeData;
    if (typeof resumeText === "string" && resumeText.trim()) return resumeDataFromPlainText(resumeText);
    return resumeData;
}

/**
 * Whether the structured copy the browser just made from a text-only résumé
 * should be saved, so the next server render has data to build the fit address
 * from. Only a signed-in viewer whose server copy has no structured content
 * (the text was all that came down) and whose structuring produced something
 * usable; a guest's résumé never leaves the device.
 */
export function shouldPersistStructured(args: {
    signedIn: boolean;
    serverData: ResumeData | undefined;
    serverText: unknown;
    structured: ResumeData | undefined;
}): boolean {
    if (!args.signedIn) return false;
    if (args.serverData && hasResumeContent(args.serverData)) return false;
    if (typeof args.serverText !== "string" || !args.serverText.trim()) return false;
    return Boolean(args.structured && resumeIsUsable(args.structured));
}
