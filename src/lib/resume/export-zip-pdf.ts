import { downloadBlob } from "@/lib/export-utils";
import { recallResumeLayout } from "@/lib/resume/layout-profile-storage";
import type { ResumeFontFiles, ResumePdfResult } from "@/lib/resume/render-pdf";
import { toast } from "@/lib/toast";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { parsedResumeToZipHtml, resumeDataToZipHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

export function zipResumeMarkdownFromData(data: ResumeData): string {
    return resumeDataToZipMarkdown(data);
}

/** HTML for PDF — built from ResumeData, never parseResumeContent. */
export function zipResumeHtmlFromData(data: ResumeData): string {
    return resumeDataToZipHtml(data);
}

const FONT_FILES = {
    sans: ["/fonts/liberation/LiberationSans-Regular.ttf", "/fonts/liberation/LiberationSans-Bold.ttf"],
    serif: ["/fonts/liberation/LiberationSerif-Regular.ttf", "/fonts/liberation/LiberationSerif-Bold.ttf"],
} as const;

function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/** Liberation Sans/Serif for a résumé with characters the built-in PDF fonts lack. */
async function loadResumeFonts(family: "sans" | "serif"): Promise<ResumeFontFiles | null> {
    try {
        const [regular, bold] = await Promise.all(
            FONT_FILES[family].map(async (url) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return toBase64(await res.arrayBuffer());
            }),
        );
        return { regular, bold };
    } catch (err) {
        // The renderer spells the few missing symbols out instead.
        console.warn("[resume-pdf] font load failed; printing with the built-in fonts", err);
        return null;
    }
}

/** Said when the tailored text needed more pages than the original has. */
export function resumeOverflowMessage(pages: number, originalPages: number): string {
    const unit = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;
    return `This résumé runs to ${unit(pages)}; your original is ${unit(originalPages)}. Fitting it would have made the text too small to read, so trim a bullet or two to bring it back to ${unit(originalPages)}.`;
}

/**
 * Every résumé download: ResumeData → resumeDataToParsedDocument → a text
 * PDF drawn on this device (`renderResumePdf`), in the layout of the
 * person's original when this device measured it at upload
 * (`recallResumeLayout`). Nothing is sent to a server.
 *
 * The server print path (/api/resume/pdf, headless Chromium) is no longer
 * used here: production has no Chromium, so every download fell back to a
 * fixed layout that ignored the original anyway.
 */
export async function exportZipResumePdfFromData(data: ResumeData, filename: string): Promise<ResumePdfResult> {
    const parsed = resumeDataToParsedDocument(data);
    const outName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    const profile = recallResumeLayout(data);
    // Loaded only here: jsPDF is ~135 KB gzipped, so it stays out of every
    // page that merely offers a download.
    const { renderResumePdf, resumeNeedsUnicodeFont } = await import("@/lib/resume/render-pdf");
    const fonts = resumeNeedsUnicodeFont(parsed) ? await loadResumeFonts(profile?.family ?? "sans") : null;
    const result = renderResumePdf(parsed, { profile, fonts });
    downloadBlob(result.bytes, outName, "application/pdf");
    if (result.originalPages !== null && !result.fits) {
        toast.info(resumeOverflowMessage(result.pages, result.originalPages), 9000);
    }
    return result;
}

/**
 * Free-text / pursuit snapshot path: structure the text into ResumeData first,
 * then the same FromData exporter. Does not call parseResumeContent.
 */
export async function exportZipResumePdf(markdown: string, filename: string): Promise<ResumePdfResult> {
    return exportZipResumePdfFromData(resumeDataFromPlainText(markdown), filename);
}

/** Node/Playwright helper — same HTML document the browser exporter uses. */
export function buildZipResumePdfHtmlFromData(data: ResumeData): string {
    return resumeDataToZipHtml(data);
}

/** @deprecated inspect/debug — PDF download must not use this. */
export function buildZipResumePdfHtmlFromMarkdown(markdown: string): string {
    return resumeDataToZipHtml(resumeDataFromPlainText(markdown));
}

export function zipResumeBodyHtmlFromData(data: ResumeData): string {
    return parsedResumeToZipHtml(resumeDataToParsedDocument(data));
}
