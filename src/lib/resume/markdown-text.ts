/**
 * Markdown résumé text → the plain lines the structurer reads. An agent files
 * résumé versions in markdown (MCP `save_resume_variant`, and the zip
 * markdown `resumeDataToZipMarkdown` writes), and the structurer took the
 * marks literally: the PDF printed "# Jane Doe" and "## PROFESSIONAL
 * SUMMARY". Pure, mechanical: it removes marks and never rewords anything.
 */

/** A heading, bold run or link: enough to say the text was written in markdown. */
const MARKDOWN_SIGNAL_RE = /^ {0,3}#{1,6}\s+\S|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^)\s]+\)/m;

export function looksLikeMarkdown(text: string): boolean {
    return MARKDOWN_SIGNAL_RE.test(text);
}

/** "[LinkedIn](https://linkedin.com/in/x)" keeps the address; "[Open-source tool](…)" keeps its words. */
function linkText(label: string, url: string): string {
    const text = label.trim();
    if (!text) return url;
    return /\s|\./.test(text) ? text : url;
}

function plainLine(line: string): string | null {
    // A rule ("---", "***", "___") is decoration, not content.
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) return null;
    let s = line
        .replace(/^ {0,3}#{1,6}\s+/, "")
        .replace(/\s+#+\s*$/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^(\s*)\+\s+/, "$1- ");
    s = s
        .replace(/!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, url: string) => linkText(label, url))
        .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
        .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
        .replace(/__([^_\n]+?)__/g, "$1")
        .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*(?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/(^|[\s(])_(?!\s)([^_\n]+?)(?<!\s)_(?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");
    return s;
}

/** Plain text, line for line (rules dropped), when `text` is markdown; `text` unchanged otherwise. */
export function markdownResumeToPlainText(text: string): string {
    if (!looksLikeMarkdown(text)) return text;
    return text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map(plainLine)
        .filter((l): l is string => l !== null)
        .join("\n");
}
