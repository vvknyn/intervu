import type { ResumeVersionSnapshot } from "./types";
import { parseResumeContent } from "@/lib/resume/parse-resume-content";
import { renderResumePdf, deriveResumePdfFilename } from "@/lib/resume/render-pdf";

export type ResumeDownloadFormat = "pdf" | "md";

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Client-side download of a resume-version snapshot. PDF is the default,
 * user-facing format (R4/R5, 2026-08-09 user report: "gets downloaded as a
 * .md file and not a pdf") — the original .md stays available as a
 * secondary, portable format via `format: "md"`. Renders through
 * `renderResumePdf` (lib/resume/render-pdf.ts) — the SAME renderer
 * YourResumeSection's base-résumé "Download .pdf" button and the R5a
 * MCP-chat download link (yours/[id]/page.tsx's `?download=pdf` handler)
 * both use, so every entry point produces byte-identical layout.
 */
export function downloadResumeVersion(
    version: ResumeVersionSnapshot,
    pursuit?: { company_name: string; position: string },
    format: ResumeDownloadFormat = "pdf",
): void {
    const filename = deriveResumePdfFilename({
        company: pursuit?.company_name,
        role: pursuit?.position,
        fallbackLabel: version.label,
        dateIso: version.saved_at,
    });
    if (format === "md") {
        triggerDownload(new Blob([version.content], { type: "text/markdown" }), `${filename}.md`);
        return;
    }
    const pdfBytes = renderResumePdf(parseResumeContent(version.content));
    triggerDownload(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }), `${filename}.pdf`);
}
