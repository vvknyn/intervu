/**
 * Mechanical (no-AI) file -> text extraction for the account "Resume"
 * section's upload path (R1, 2026-08-09 user report). Dispatches by file
 * extension: .txt/.md read directly in the browser; .pdf/.docx run through
 * the SAME in-browser extractors (extractPDFTextInBrowser/
 * extractDocxTextInBrowser, lib/local-ai/extract-in-browser.ts) that back
 * the resume builder's import modal (ResumeImportModal.tsx) — unpdf/mammoth
 * run in-page, so résumé bytes never leave the browser here either. Kept as
 * its own module rather than reused verbatim from ResumeImportModal's inline
 * `processFile` because that function is tangled with the builder's review-
 * step state; this is the reusable extension-dispatch mechanism the account
 * upload path needs on its own.
 *
 * Soft-fail: when extractable text is empty (image-only / scanned PDF), throw
 * a re-upload / paste message — never return "" and pretend the upload worked.
 */
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "@/lib/local-ai/extract-in-browser";

export const SUPPORTED_RESUME_FILE_EXTENSIONS = ["txt", "md", "pdf", "docx", "doc"] as const;
export type SupportedResumeFileExtension = (typeof SUPPORTED_RESUME_FILE_EXTENSIONS)[number];

/** Shown when PDF/DOCX yields no usable extractable text (image-heavy jsPDF dumps, scans). */
export const EMPTY_EXTRACTABLE_TEXT_MESSAGE =
    "No text could be extracted from this file. It may be image-based or scanned. Please re-upload a text PDF (or .docx/.txt) or paste your resume text instead.";

/** Pure: filename -> its recognized extension, or null when unsupported. */
export function resumeFileExtension(filename: string): SupportedResumeFileExtension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_RESUME_FILE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SupportedResumeFileExtension) : null;
}

/**
 * Extracts plain text from a résumé file, client-side entry point. Throws
 * with a human-readable message on an unsupported type, failed extraction,
 * or empty extractable text — callers show the message, never pretend success.
 */
export async function extractResumeFileText(file: File): Promise<string> {
  const ext = resumeFileExtension(file.name);
  if (!ext) throw new Error("Unsupported file type. Please use .txt, .md, .pdf, or .docx.");
  if (ext === "txt" || ext === "md") {
    const text = (await file.text()).trim();
    if (!text) throw new Error(EMPTY_EXTRACTABLE_TEXT_MESSAGE);
    return text;
  }

  const buffer = await file.arrayBuffer();
  const result = ext === "pdf" ? await extractPDFTextInBrowser(buffer) : await extractDocxTextInBrowser(buffer);
  if (result.error) throw new Error(result.error);
  const text = (result.text ?? "").trim();
  if (!text) throw new Error(EMPTY_EXTRACTABLE_TEXT_MESSAGE);
  return text;
}
