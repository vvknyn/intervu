import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { downloadBlob } from "@/lib/export-utils";
import { parseResumeContent } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, DEFAULT_PAGE_METRICS } from "@/lib/resume/render-pdf";
import { resumeDataToZipMarkdown } from "@/lib/resume/to-zip-markdown";
import { zipMarkdownToHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

const CANVAS_SCALE = 2.5;
const LETTER_WIDTH_PT = DEFAULT_PAGE_METRICS.pageWidth;
const LETTER_HEIGHT_PT = DEFAULT_PAGE_METRICS.pageHeight;

export function zipResumeMarkdownFromData(data: ResumeData): string {
    return resumeDataToZipMarkdown(data);
}

export function zipResumeHtmlFromData(data: ResumeData): string {
    return zipMarkdownToHtml(resumeDataToZipMarkdown(data));
}

function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}

async function mountHtmlInIframe(html: string): Promise<{ iframe: HTMLIFrameElement; page: HTMLElement }> {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.left = "-10000px";
    iframe.style.top = "0";
    iframe.style.width = "8.5in";
    iframe.style.height = "11in";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) throw new Error("iframe document unavailable");
    doc.open();
    doc.write(html);
    doc.close();

    await waitForPaint();
    await new Promise((r) => setTimeout(r, 50));

    const page = doc.querySelector(".resume-page");
    if (!(page instanceof HTMLElement)) {
        document.body.removeChild(iframe);
        throw new Error("resume page element missing");
    }

    return { iframe, page };
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
    const { iframe, page } = await mountHtmlInIframe(html);
    try {
        const canvas = await html2canvas(page, {
            scale: CANVAS_SCALE,
            useCORS: true,
            logging: false,
            backgroundColor: "#ffffff",
            width: page.scrollWidth,
            height: page.scrollHeight,
            windowWidth: page.scrollWidth,
            windowHeight: page.scrollHeight,
        });
        return canvasToLetterPdf(canvas);
    } finally {
        document.body.removeChild(iframe);
    }
}

/**
 * Client-side zip résumé PDF: markdown → HTML/CSS → html2canvas → jsPDF (US Letter).
 * Falls back to jsPDF draw commands if the HTML path throws. Never uploads content.
 */
export async function exportZipResumePdf(markdown: string, filename: string): Promise<void> {
    const html = zipMarkdownToHtml(markdown);
    try {
        const bytes = await renderZipHtmlToPdfBytes(html);
        downloadBlob(bytes, filename.endsWith(".pdf") ? filename : `${filename}.pdf`, "application/pdf");
    } catch (err) {
        console.warn("HTML résumé PDF export failed, falling back to jsPDF:", err);
        const parsed = parseResumeContent(markdown);
        const fallback = renderResumePdf(parsed);
        downloadBlob(fallback, filename.endsWith(".pdf") ? filename : `${filename}.pdf`, "application/pdf");
    }
}

/** Node/Playwright helper — same HTML document the browser exporter uses. */
export function buildZipResumePdfHtmlFromMarkdown(markdown: string): string {
    return zipMarkdownToHtml(markdown);
}
