/**
 * The tailored résumé as a PDF, made in the panel (and in the service worker,
 * for the résumé the card attaches to an application form) with the same renderer and
 * settings velai.app's "Customize for this job" download uses (one page, the
 * role's terms passed for emphasis). Nothing leaves the browser.
 *
 * Unlike the site, the extension can't see the layout velai.app remembered
 * from the person's uploaded file (it lives in that site's storage), so the
 * PDF uses Velai's default layout.
 */
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, resumeNeedsUnicodeFont, type ResumeFontFiles } from "@/lib/resume/render-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/pdf-filename";
import { roleTermsForJob } from "@/lib/local-ai/tailor-resume";
import { jobToTailorInput } from "@/lib/local-ai/tailor-ground";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

const FONT_FILES = ["fonts/LiberationSans-Regular.ttf", "fonts/LiberationSans-Bold.ttf"] as const;

export function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/** The bundled Liberation Sans, for a résumé with characters the built-in PDF fonts lack. */
async function loadFonts(): Promise<ResumeFontFiles | null> {
    try {
        const [regular, bold] = await Promise.all(
            FONT_FILES.map(async (file) => toBase64(await (await fetch(file)).arrayBuffer())),
        );
        return { regular, bold };
    } catch {
        // The renderer spells the few missing symbols out instead.
        return null;
    }
}

/** Builds the PDF and returns it with the file name the site would give it. */
export async function tailoredResumePdf(tailored: ResumeData, job: PublicJob): Promise<{ blob: Blob; filename: string }> {
    const parsed = resumeDataToParsedDocument(tailored);
    const fonts = resumeNeedsUnicodeFont(parsed) ? await loadFonts() : null;
    const result = renderResumePdf(parsed, { fonts, onePage: true, roleTerms: roleTermsForJob(jobToTailorInput(job)) });
    const filename = deriveResumePdfFilename({
        company: null,
        role: tailored.profile.profession || null,
        fallbackLabel: tailored.profile.name || "resume",
        dateIso: new Date().toISOString(),
    });
    return { blob: new Blob([result.bytes], { type: "application/pdf" }), filename: `${filename}.pdf` };
}
