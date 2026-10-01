/**
 * The ingest-time HTML → text step job descriptions go through before they
 * reach Velai: a copy of subspace `src/lib/job-enricher.ts` `stripHtml`
 * (2026-09-30, d5560f5). Every block tag becomes a newline, so an ATS
 * page's `<li>` items and `<p><strong>` titles arrive as bare lines split
 * by blank lines, with no bullet or heading left to say which is which.
 * Fixtures run through this so tests see what production sees.
 */
export function stripHtmlLikeIngest(html: string): string {
    let text = html;
    text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|section|article|header|footer|blockquote)\b[^>]*\/?>/gi, "\n");
    text = text.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n");
    text = text.replace(/<[^>]+>/g, " ");
    text = text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&rsquo;/gi, "’")
        .replace(/&#39;/gi, "'");
    text = text.replace(/[^\S\n]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}
