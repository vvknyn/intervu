/**
 * Reads the words off a PDF that has no text layer: a scan, a phone photo
 * saved as PDF, or a design tool that turned its text into shapes. Same
 * founder rule as extract-in-browser.ts: the pages are drawn and read in
 * this browser and never leave it. Tesseract's worker, engine and English
 * model are served from our own origin (`public/ocr/`, copied out of
 * node_modules by scripts/copy-ocr-assets.mjs on every build) and load only
 * when such a PDF arrives: about 7 MB once, then the browser's cache.
 */

import { pdfPageText, type PdfTextItem } from "@/lib/local-ai/pdf-text-lines";

/** The slice of pdf.js's document this needs (unpdf's `getDocumentProxy`). */
export interface OcrPdfDocument {
    numPages: number;
    getPage(n: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number };
        render(params: Record<string, unknown>): { promise: Promise<unknown> };
    }>;
}

/** Where public/ocr is served. */
export const OCR_ASSET_PATH = "/ocr";
/** A résumé's first pages carry everything matching needs; more is minutes on a phone. */
export const OCR_MAX_PAGES = 3;
/** ~180 dpi on a Letter page: Tesseract's sweet spot, and a phone's canvas limit stays far off. */
const RENDER_SCALE = 2.5;

/** What the engine makes of a printed bullet ("•" reads as "«", "©", "°", "*"…), at a line's start. */
const OCR_BULLET_RE = /^[ \t]*[«»©®°*¢•·◦▪■●○‣⁃>~+.-][ \t]+/gm;

/** Pure: engine output → résumé text the rules parser reads like any other: real bullets, no stray blank runs. */
export function tidyOcrText(text: string): string {
    return text
        .replace(OCR_BULLET_RE, "• ")
        // "Certificate Ill", "Level lV": the engine's l for I in a Roman numeral after a level word.
        .replace(/\b(Certificate|Cert\.?|Level|Grade|Class|Part|Stage|Tier)\s+([IVXl]{1,4})\b/g, (_, word: string, numeral: string) => `${word} ${numeral.replace(/l/g, "I")}`)
        // A printed comma or middot between skills often comes back as «, », * or +.
        // Line-start marks are already bullets; these are the ones left between words.
        .replace(/[«»]/g, ", ")
        .replace(/(^|[^\S\n])[*+](?=[^\S\n])/g, "$1,")
        .replace(/[ \t]*\|+[ \t]*$/gm, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** The slice of Tesseract's page layout this reads: blocks → paragraphs → lines → words, in pixels from the top left. */
export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrLine {
    bbox: OcrBox;
    baseline: OcrBox;
    rowAttributes?: { rowHeight?: number };
    words: Array<{ text: string; bbox: OcrBox }>;
}
export interface OcrBlock { paragraphs: Array<{ lines: OcrLine[] }> }

/** A lone mark the engine read where a bullet was printed. */
const OCR_BULLET_WORD_RE = /^[«»©®°*¢•·◦▪■●○‣⁃>~+.-]$/;

/**
 * Pure: one page's layout → its text through the same line joiner a text
 * PDF goes through (pdf-text-lines.ts), so a wrapped bullet, summary or
 * skill list comes back as one line here too. Words become text items in
 * points (pixels ÷ `scale`, y up from the page's bottom), a line's size is
 * the page's usual line height unless the line is clearly bigger (a name
 * or heading), and a misread bullet becomes "•".
 */
export function ocrPageText(blocks: OcrBlock[], scale: number, pageHeightPx: number): string {
    const lines = blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).filter((l) => l.words.some((w) => w.text.trim()));
    if (lines.length === 0) return "";
    const heightOf = (l: OcrLine) => (l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0) / scale;
    const sorted = lines.map(heightOf).sort((a, b) => a - b);
    const usual = sorted[Math.floor(sorted.length / 2)];
    const items: PdfTextItem[] = [];
    for (const line of lines) {
        const own = heightOf(line);
        const size = own > usual * 1.25 ? Math.round(own * 10) / 10 : usual;
        const baseline = (pageHeightPx - (line.baseline?.y0 ?? line.bbox.y1)) / scale;
        const words = line.words.filter((w) => w.text.trim());
        words.forEach((word, i) => {
            const text = i === 0 && words.length > 1 && OCR_BULLET_WORD_RE.test(word.text.trim()) ? "•" : word.text.trim();
            const last = i === words.length - 1;
            items.push({
                str: last ? text : `${text} `,
                transform: [1, 0, 0, 1, word.bbox.x0 / scale, baseline],
                width: (word.bbox.x1 - word.bbox.x0) / scale,
                height: size,
                hasEOL: last,
            });
        });
    }
    return pdfPageText(items);
}

/** Text of the first pages, in reading order: a line per paragraph, bullet or heading. */
export async function ocrPdfInBrowser(pdf: OcrPdfDocument): Promise<string> {
    const { createWorker, OEM } = await import("tesseract.js");
    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${OCR_ASSET_PATH}/worker.min.js`,
        corePath: OCR_ASSET_PATH,
        langPath: OCR_ASSET_PATH,
        workerBlobURL: false,
    });
    try {
        const pages: string[] = [];
        for (let n = 1; n <= Math.min(pdf.numPages, OCR_MAX_PAGES); n++) {
            const page = await pdf.getPage(n);
            const viewport = page.getViewport({ scale: RENDER_SCALE });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d");
            if (!context) break;
            // A white page: transparent pixels read as black to the engine.
            context.fillStyle = "#fff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
            const laidOut = data.blocks ? ocrPageText(data.blocks as unknown as OcrBlock[], RENDER_SCALE, canvas.height) : "";
            pages.push(laidOut || data.text || "");
            canvas.width = 0;
            canvas.height = 0;
        }
        return tidyOcrText(pages.join("\n\n"));
    } finally {
        await worker.terminate();
    }
}
