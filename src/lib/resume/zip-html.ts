import { RESUME_ZIP_CSS } from "@/lib/resume/resume-zip.css";
import { parseResumeContent, type ParsedResumeBlock, type ParsedResumeDocument } from "@/lib/resume/parse-resume-content";

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderBlock(block: ParsedResumeBlock): string {
    switch (block.kind) {
        case "paragraph":
            return `<p class="resume-paragraph">${escapeHtml(block.text)}</p>`;
        case "competency":
            return `<p class="resume-competency"><strong>${escapeHtml(block.category)}:</strong> ${escapeHtml(block.items)}</p>`;
        case "bullets":
            if (block.items.length === 0) return "";
            return `<ul class="resume-bullets">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
        case "entry": {
            const dateHtml = block.dateRight
                ? `<span class="resume-entry-dates">${escapeHtml(block.dateRight)}</span>`
                : "";
            const bullets =
                block.bullets.length > 0
                    ? `<ul class="resume-bullets">${block.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
                    : "";
            return `<div class="resume-entry"><div class="resume-entry-header"><span class="resume-entry-title">${escapeHtml(block.title)}</span>${dateHtml}</div>${bullets}</div>`;
        }
        default:
            return "";
    }
}

function renderSection(section: ParsedResumeDocument["sections"][number]): string {
    const blocks = section.blocks.map(renderBlock).filter(Boolean).join("");
    if (!section.heading && !blocks) return "";
    const heading = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : "";
    return `<section class="resume-section">${heading}${blocks}</section>`;
}

/** Parsed résumé document → body HTML fragment (no document wrapper). */
export function parsedResumeToZipHtml(doc: ParsedResumeDocument): string {
    const parts: string[] = ['<div class="resume-page">'];

    if (doc.name) {
        parts.push(`<h1 class="resume-name">${escapeHtml(doc.name)}</h1>`);
    }
    if (doc.contactLine) {
        parts.push(`<p class="resume-contact">${escapeHtml(doc.contactLine)}</p>`);
    }

    for (const section of doc.sections) {
        const html = renderSection(section);
        if (html) parts.push(html);
    }

    parts.push("</div>");
    return parts.join("");
}

/** Full self-contained HTML document with inlined zip CSS. */
export function buildZipResumeDocument(bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resume</title>
<style>${RESUME_ZIP_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Markdown (zip shape) → full HTML document string. */
export function zipMarkdownToHtml(markdown: string): string {
    const doc = parseResumeContent(markdown);
    return buildZipResumeDocument(parsedResumeToZipHtml(doc));
}
