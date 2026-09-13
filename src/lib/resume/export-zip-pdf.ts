import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { downloadBlob } from "@/lib/export-utils";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, DEFAULT_PAGE_METRICS } from "@/lib/resume/render-pdf";
import { RESUME_ZIP_CSS } from "@/lib/resume/resume-zip.css";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { buildZipResumeDocument, parsedResumeToZipHtml, resumeDataToZipHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

const CANVAS_SCALE = 2.5;
const LETTER_WIDTH_PT = DEFAULT_PAGE_METRICS.pageWidth;
const LETTER_HEIGHT_PT = DEFAULT_PAGE_METRICS.pageHeight;

export function zipResumeMarkdownFromData(data: ResumeData): string {
    return resumeDataToZipMarkdown(data);
}

/** HTML for PDF — built from ResumeData, never parseResumeContent. */
export function zipResumeHtmlFromData(data: ResumeData): string {
    return resumeDataToZipHtml(data);
}

function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}

/**
 * Same-document offscreen host. html2canvas cannot reliably capture nodes
 * inside a hidden iframe (parent-window canvas + iframe document throws),
 * which is what pushed Customize into the jsPDF fallback.
 */
async function mountHtmlOffscreen(html: string): Promise<{ host: HTMLElement; page: HTMLElement }> {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const sourcePage = parsed.querySelector(".resume-page");
    if (!sourcePage) throw new Error("resume page element missing");

    const host = document.createElement("div");
    host.setAttribute("data-resume-zip-export", "true");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
        "position:fixed",
        "left:-10000px",
        "top:0",
        "width:8.5in",
        "background:#ffffff",
        "pointer-events:none",
        "z-index:-1",
    ].join(";");

    const style = document.createElement("style");
    style.textContent = RESUME_ZIP_CSS;
    host.appendChild(style);
    const page = document.importNode(sourcePage, true) as HTMLElement;
    host.appendChild(page);
    document.body.appendChild(host);

    await waitForPaint();
    await new Promise((r) => setTimeout(r, 50));
    return { host, page };
}

function canvasToLetterPdf(canvas: HTMLCanvasElement): ArrayBuffer {
    const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
    const pageWidthPx = canvas.width;
    const pageHeightPx = Math.round((LETTER_HEIGHT_PT / LETTER_WIDTH_PT) * pageWidthPx);

    let renderedHeight = 0;
    let pageIndex = 0;

    while (renderedHeight < canvas.height) {
        const sliceHeight = Math.min(pageHeightPx, canvas.height - renderedHeight);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = pageWidthPx;
        pageCanvas.height = sliceHeight;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d unavailable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, renderedHeight, pageWidthPx, sliceHeight, 0, 0, pageWidthPx, sliceHeight);

        const imgData = pageCanvas.toDataURL("image/png");
        const imgHeightPt = (sliceHeight / pageWidthPx) * LETTER_WIDTH_PT;

        if (pageIndex > 0) pdf.addPage([LETTER_WIDTH_PT, LETTER_HEIGHT_PT], "portrait");
        pdf.addImage(imgData, "PNG", 0, 0, LETTER_WIDTH_PT, imgHeightPt);

        renderedHeight += sliceHeight;
        pageIndex += 1;
    }

    return pdf.output("arraybuffer");
}

async function renderZipHtmlToPdfBytes(html: string): Promise<ArrayBuffer> {
    const { host, page } = await mountHtmlOffscreen(html);
    try {
        const canvas = await html2canvas(page, {
            scale: CANVAS_SCALE,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
            width: page.scrollWidth,
            height: page.scrollHeight,
            windowWidth: Math.max(page.scrollWidth, 816),
            windowHeight: Math.max(page.scrollHeight, 1056),
        });
        if (!canvas.width || !canvas.height) {
            throw new Error("html2canvas produced an empty canvas");
        }
        return canvasToLetterPdf(canvas);
    } finally {
        host.remove();
    }
}

/**
 * Primary Customize / Download path:
 * ResumeData → resumeDataToParsedDocument → parsedResumeToZipHtml → canvas → Letter PDF.
 * Fallback is `renderResumePdf(parsed)` from the same structured doc — never parseResumeContent(md).
 */
export async function exportZipResumePdfFromData(data: ResumeData, filename: string): Promise<void> {
    const parsed = resumeDataToParsedDocument(data);
    const html = buildZipResumeDocument(parsedResumeToZipHtml(parsed));
    const outName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    try {
        const bytes = await renderZipHtmlToPdfBytes(html);
        downloadBlob(bytes, outName, "application/pdf");
    } catch (err) {
        console.error("[resume-pdf] HTML export failed; falling back to jsPDF layout from ResumeData (not markdown parse)", err);
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
