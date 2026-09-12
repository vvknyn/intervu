/** Join phrases for the search bar / URL. 0 → ""; 1 → raw phrase; 2+ → `"A" OR "B"`. Strip embedded quotes. */
export function formatQuotedOrQuery(phrases: string[]): string {
    const cleaned = phrases
        .map((s) => (s ?? "").trim().replace(/"/g, ""))
        .filter(Boolean);
    if (cleaned.length === 0) return "";
    if (cleaned.length === 1) return cleaned[0];
    return cleaned.map((p) => `"${p}"`).join(" OR ");
}

/**
 * Parse `"A" OR "B"` (case-insensitive OR, each part exactly `"..."`).
 * Returns null unless the WHOLE trimmed q is that form with ≥2 non-empty phrases.
 * Do not accept unquoted `A OR B`.
 */
export function parseQuotedOrPhrases(q: string): string[] | null {
    const trimmed = (q ?? "").trim();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+OR\s+/i);
    if (parts.length < 2) return null;

    const phrases: string[] = [];
    for (const part of parts) {
        const p = part.trim();
        const match = /^"(.*)"$/.exec(p);
        if (!match) return null;
        const inner = match[1].replace(/"/g, "").trim();
        if (!inner) return null;
        phrases.push(inner);
    }

    return phrases.length >= 2 ? phrases : null;
}

/** Prefer explicit fitPhrases (≥2 trimmed) else parseQuotedOrPhrases(q). */
export function resolveFitPhrases(p: { q?: string; fitPhrases?: string[] }): string[] | null {
    const explicit = (p.fitPhrases ?? [])
        .map((s) => (s ?? "").trim().replace(/"/g, ""))
        .filter(Boolean);
    if (explicit.length >= 2) return explicit;
    return parseQuotedOrPhrases(p.q ?? "");
}

export function shouldRunFitPhraseLane(p: { q?: string; fitPhrases?: string[] }): boolean {
    const phrases = resolveFitPhrases(p);
    return phrases != null && phrases.length >= 2;
}
