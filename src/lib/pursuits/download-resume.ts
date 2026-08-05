import type { ResumeVersionSnapshot } from "./types";

/** Client-side download of a resume-version snapshot (markdown). */
export function downloadResumeVersion(version: ResumeVersionSnapshot, pursuit?: { company_name: string; position: string }): void {
    const base = version.label.replace(/[^\w.-]+/g, "-");
    const suffix =
        pursuit != null
            ? `-${pursuit.company_name.replace(/[^\w.-]+/g, "-").toLowerCase()}-${pursuit.position.replace(/[^\w.-]+/g, "-").toLowerCase()}`
            : "";
    const blob = new Blob([version.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}${suffix}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
