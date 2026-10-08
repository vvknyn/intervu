import { pdfPageText, type PdfTextItem } from "@/lib/local-ai/pdf-text-lines";
import { measureResumeLayout, type LayoutPage, type LayoutTextItem } from "@/lib/resume/layout-profile";
import { rememberResumeLayout } from "@/lib/resume/layout-profile-storage";

/**
 * Browser-side résumé text extraction. Founder rule: résumé interpretation
 * never happens on our servers — extraction and parsing both run entirely
 * on-device. This is the sole PDF/DOCX extraction path for résumé bytes:
 * `ResumeImportModal` (resume-builder import) and `extractResumeFileText`
 * (Settings "Your Resume" upload, `lib/resume/extract-file-text.ts`) both
 * call these instead of ever sending file bytes to a server action. `unpdf`
 * and `mammoth` both ship browser-safe builds (no new dependency —
 * `mammoth`'s package.json remaps `lib/unzip.js` to `browser/unzip.js`,
 * which reads an `arrayBuffer` directly; `unpdf` has one isomorphic entry
 * point).
 *
 * Same length thresholds and error copy as the deleted server-side PDF/DOCX
 * extraction actions they replaced, so error handling and confidence
 * scoring behave identically to before.
 *
 * DOCX uses mammoth's own prebuilt browser bundle (`mammoth.browser.js`,
 * shipped in the package for exactly this — script-tag/bundler-agnostic
 * browser use) rather than the bare `"mammoth"` entry point.
 *
 * A PDF's layout (paper, margins, type sizes, spacing, page count) is
 * measured from the same text positions and remembered on this device
 * (`layout-profile.ts`), so the résumés later downloaded from it print the
 * way the original does. The bare entry
 * resolves to the Node build unless a bundler's `resolve.aliasFields`
 * rewrites it via the package's legacy `browser` field — a build-tool
 * behavior this module shouldn't have to depend on to run correctly in a
 * browser, and one plain Node (so `node:test`) can't replicate at all.
 */

/** A PDF with no text layer: saved as pictures of its pages (a scan, a photo, or a design tool that outlines its text). */
export const PDF_NO_TEXT_MESSAGE =
    "This PDF has no text we can read. It was likely saved as an image (a scan, or a design tool that turns text into pictures). Paste your résumé text instead, or upload it as a Word file.";

export async function extractPDFTextInBrowser(
    buffer: ArrayBuffer,
): Promise<{ text?: string; error?: string }> {
    try {
        const bytes = new Uint8Array(buffer);
        const header = String.fromCharCode(...bytes.slice(0, 5));
        if (!header.startsWith("%PDF")) {
            return { error: "The file does not appear to be a valid PDF. Please check the file format." };
        }

        let pages: string[];
        // Every text item as pdf.js reports it, for a page the line joiner reads as empty.
        let itemText = "";
        const layoutPages: LayoutPage[] = [];
        try {
            // Page text with each paragraph and bullet on one line, not one
            // line per printed line (pdf-text-lines.ts).
            const { getDocumentProxy } = await import("unpdf");
            const pdf = await getDocumentProxy(bytes);
            pages = [];
            for (let n = 1; n <= pdf.numPages; n++) {
                const page = await pdf.getPage(n);
                const content = await page.getTextContent();
                const items = content.items as PdfTextItem[];
                pages.push(pdfPageText(items));
                itemText += items.map((item) => (typeof item.str === "string" ? item.str : "")).join(" ") + "\n\n";
                const [x0, y0, x1, y1] = page.view;
                layoutPages.push({
                    width: x1 - x0,
                    height: y1 - y0,
                    origin: [x0, y0],
                    items: content.items as LayoutTextItem[],
                    styles: content.styles,
                });
            }
        } catch (parseError: any) {
            const msg = parseError?.message || "";
            if (/password/i.test(msg)) {
                return { error: "This PDF is password-protected. Please unlock it or paste the text directly." };
            }
            if (/encrypt/i.test(msg)) {
                return { error: "This PDF is encrypted. Please use an unencrypted version or paste the text directly." };
            }
            return { error: `Could not parse PDF: ${msg}. Please try pasting the content directly.` };
        }

        let rawText = pages.join("\n\n");
        // The joiner drops nothing on its own, but a file whose items it
        // can't place still has its words: never call a PDF with text empty.
        if (rawText.trim().length < 20 && itemText.trim().length >= 20) rawText = itemText;
        if (!rawText || rawText.trim().length < 20) {
            return { error: PDF_NO_TEXT_MESSAGE };
        }

        const cleanedText = rawText
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        try {
            const profile = measureResumeLayout(layoutPages);
            if (profile) rememberResumeLayout(cleanedText, profile);
        } catch {
            // Layout is a nicety: the text is what the upload needs.
        }

        return { text: cleanedText };
    } catch (e: any) {
        const errorMsg = e?.message || "Unknown error";
        return { error: `Failed to extract text from PDF: ${errorMsg}. Please try pasting the content directly.` };
    }
}

export async function extractDocxTextInBrowser(
    buffer: ArrayBuffer,
): Promise<{ text?: string; error?: string }> {
    try {
        const mammoth = await import("mammoth/mammoth.browser.js");
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });

        if (!result.value || result.value.trim().length < 50) {
            return { error: "Could not extract text from DOCX. The file may be empty or corrupted." };
        }

        return { text: result.value };
    } catch {
        return { error: "Failed to extract text from DOCX. Please try pasting the content directly." };
    }
}
