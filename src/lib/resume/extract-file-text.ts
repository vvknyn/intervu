/**
 * Mechanical (no-AI) file -> text extraction for the account "Resume"
 * section's upload path (R1, 2026-08-09 user report). Dispatches by file
 * extension: .txt/.md read directly in the browser; .pdf/.docx round-trip
 * through the SAME server actions (extractPDFText/extractDocxText,
 * actions/resume.ts) that already back the resume builder's import modal
 * (ResumeImportModal.tsx) — unpdf/mammoth, both already in package.json, no
 * new extraction dependency. Kept as its own module rather than reused
 * verbatim from ResumeImportModal's inline `processFile` because that
 * function is tangled with the builder's AI-parse content-type state; this
 * is the reusable extension-dispatch mechanism the account upload path
 * needs on its own.
 */
import { extractPDFText, extractDocxText } from "@/actions/resume";

export const SUPPORTED_RESUME_FILE_EXTENSIONS = ["txt", "md", "pdf", "docx", "doc"] as const;
export type SupportedResumeFileExtension = (typeof SUPPORTED_RESUME_FILE_EXTENSIONS)[number];

/** Pure: filename -> its recognized extension, or null when unsupported. */
export function resumeFileExtension(filename: string): SupportedResumeFileExtension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (SUPPORTED_RESUME_FILE_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SupportedResumeFileExtension) : null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Extracts plain text from a résumé file, client-side entry point. Throws
 * with a human-readable message on an unsupported type or a failed
 * extraction (mirrors extractPDFText/extractDocxText's own `{ error }`
 * shape) — callers show the message, never a raw stack.
 */
export async function extractResumeFileText(file: File): Promise<string> {
  const ext = resumeFileExtension(file.name);
  if (!ext) throw new Error("Unsupported file type. Please use .txt, .md, .pdf, or .docx.");
  if (ext === "txt" || ext === "md") return file.text();

  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  const result = ext === "pdf" ? await extractPDFText(base64) : await extractDocxText(base64);
  if (result.error) throw new Error(result.error);
  return result.text ?? "";
}
