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
 * browser use) rather than the bare `"mammoth"` entry point. The bare entry
 * resolves to the Node build unless a bundler's `resolve.aliasFields`
 * rewrites it via the package's legacy `browser` field — a build-tool
 * behavior this module shouldn't have to depend on to run correctly in a
 * browser, and one plain Node (so `node:test`) can't replicate at all.
 */

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
        try {
            const { extractText } = await import("unpdf");
            const result = await extractText(bytes);
            pages = result.text;
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

        const rawText = pages.join("\n\n");
        if (!rawText || rawText.trim().length < 20) {
            return {
                error: "No text could be extracted from this PDF. It may be an image-based/scanned document. Please paste your resume text instead.",
            };
        }

        const cleanedText = rawText
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

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
