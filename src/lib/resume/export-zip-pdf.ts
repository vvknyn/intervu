import { downloadBlob } from "@/lib/export-utils";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { buildZipResumeDocument, parsedResumeToZipHtml, resumeDataToZipHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

export function zipResumeMarkdownFromData(data: ResumeData): string {
    return resumeDataToZipMarkdown(data);
}

/** HTML for PDF — built from ResumeData, never parseResumeContent. */
export function zipResumeHtmlFromData(data: ResumeData): string {
    return resumeDataToZipHtml(data);
}

async function fetchChromeTextPdf(html: string): Promise<ArrayBuffer> {
    const res = await fetch("/api/resume/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html }),
    });
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const json = (await res.json()) as { error?: string };
            if (json.error) detail = json.error;
        } catch {
            /* ignore */
        }
        throw new Error(detail);
    }
    return res.arrayBuffer();
}

/**
 * Primary Customize / For-you / Download path:
 * ResumeData → resumeDataToParsedDocument → parsedResumeToZipHtml →
 * Chromium/Skia print-to-pdf (via /api/resume/pdf).
 *
 * Fallback is text `renderResumePdf(parsed)` from the same structured doc —
 * never canvas/image raster PDF, never parseResumeContent(md).
 */
export async function exportZipResumePdfFromData(data: ResumeData, filename: string): Promise<void> {
    const parsed = resumeDataToParsedDocument(data);
    const html = buildZipResumeDocument(parsedResumeToZipHtml(parsed));
    const outName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    try {
        const bytes = await fetchChromeTextPdf(html);
        downloadBlob(bytes, outName, "application/pdf");
    } catch (err) {
        console.error(
            "[resume-pdf] Chrome/Skia print failed; falling back to text jsPDF layout from ResumeData (not markdown parse, not canvas raster)",
            err,
        );
        // Loaded only here: jsPDF is ~135 KB gzipped and this fallback is rare,
        // so it stays out of every page that merely offers a download.
        const { renderResumePdf } = await import("@/lib/resume/render-pdf");
        downloadBlob(renderResumePdf(parsed), outName, "application/pdf");
    }
}

/**
 * Free-text / pursuit snapshot path: structure the text into ResumeData first,
 * then the same FromData exporter. Does not call parseResumeContent.
 */
export async function exportZipResumePdf(markdown: string, filename: string): Promise<void> {
    await exportZipResumePdfFromData(resumeDataFromPlainText(markdown), filename);
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
