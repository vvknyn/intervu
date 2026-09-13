import type { ResumeVersionSnapshot } from "./types";
import { exportZipResumePdf } from "@/lib/resume/export-zip-pdf";
import { deriveResumePdfFilename } from "@/lib/resume/render-pdf";

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
 * secondary, portable format via `format: "md"`. Renders through the zip
 * markdown → HTML/CSS → PDF path (`exportZipResumePdf`), with jsPDF draw
 * commands as fallback if the HTML path throws.
 */
export async function downloadResumeVersion(
    version: ResumeVersionSnapshot,
    pursuit?: { company_name: string; position: string },
    format: ResumeDownloadFormat = "pdf",
): Promise<void> {
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
    await exportZipResumePdf(version.content, `${filename}.pdf`);
}
