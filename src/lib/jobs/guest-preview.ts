/**
 * Guest job-detail preview (Grok UX wave G4) — the ONE arbitration point for
 * how much of a real job description a signed-out visitor sees.
 *
 * Before this, guests saw the WHOLE detail body blurred behind a paywall
 * overlay ("Sign in to view this role") — an opaque promise rather than an
 * honest preview. This instead shows the first ~500 characters of the REAL
 * description as plain text, so a guest can judge whether the role is worth
 * signing in for.
 *
 * Reuses `stripResidualHtml`/`normalizeMarkdown` from format-description.ts
 * — the SAME sanitization `formatDescription` already runs over this exact
 * field for signed-in users — rather than a second, parallel text-cleaning
 * pass that could drift from it.
 */
import { normalizeMarkdown, stripResidualHtml } from "@/lib/jobs/format-description";

export interface GuestPreview {
    /** Plain-text preview, HTML/Markdown-stripped, collapsed to single-line prose. */
    text: string;
    /** True when `text` is a truncated prefix of a longer description (fade + CTA render only then). */
    truncated: boolean;
}

export const GUEST_PREVIEW_CHAR_LIMIT = 500;

/**
 * Truncates at the last whitespace boundary at/before `limit` so a preview
 * never ends mid-word — falls back to a hard cut only when no boundary
 * exists in the back 40% of the window (an unbroken run of 300+ chars with
 * no space), which would otherwise truncate to an unhelpfully short prefix.
 */
export function buildGuestPreview(raw: string | null | undefined, limit: number = GUEST_PREVIEW_CHAR_LIMIT): GuestPreview {
    const plain = normalizeMarkdown(stripResidualHtml((raw ?? "").replace(/\r\n?/g, "\n")))
        .replace(/\s+/g, " ")
        .trim();
    if (!plain) return { text: "", truncated: false };
    if (plain.length <= limit) return { text: plain, truncated: false };

    const cut = plain.slice(0, limit);
    const lastSpace = cut.lastIndexOf(" ");
    const text = (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
    return { text, truncated: true };
}
