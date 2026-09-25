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
 */
import { extractPDFTextInBrowser, extractDocxTextInBrowser } from "@/lib/local-ai/extract-in-browser";

export const SUPPORTED_RESUME_FILE_EXTENSIONS = ["txt", "md", "pdf", "docx", "doc"] as const;
export type SupportedResumeFileExtension = (typeof SUPPORTED_RESUME_FILE_EXTENSIONS)[number];

/** Pure: filename -> its recognized extension, or null when unsupported. */
export function resumeFileExtension(filename: string): SupportedResumeFileExtension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_RESUME_FILE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SupportedResumeFileExtension) : null;
}

/**
 * Extracts plain text from a résumé file, client-side entry point. Throws
 * with a human-readable message on an unsupported type or a failed
 * extraction (mirrors extractPDFTextInBrowser/extractDocxTextInBrowser's own
 * `{ error }` shape) — callers show the message, never a raw stack.
 */
export async function extractResumeFileText(file: File): Promise<string> {
  const ext = resumeFileExtension(file.name);
  if (!ext) throw new Error("Unsupported file type. Please use .txt, .md, .pdf, or .docx.");
  if (ext === "txt" || ext === "md") return file.text();

  const buffer = await file.arrayBuffer();
  const result = ext === "pdf" ? await extractPDFTextInBrowser(buffer) : await extractDocxTextInBrowser(buffer);
  if (result.error) throw new Error(result.error);
  // Soft-fail empty extract (scanned/image-only PDFs, blank docs) — return ""
  // so callers can treat it as no content instead of crashing the upload path.
  return (result.text ?? "").trim();
}
