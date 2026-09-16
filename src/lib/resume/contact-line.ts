/**
 * Shared heuristics for résumé contact / location lines — used by
 * `parse-resume-content.ts` (free-text PDF path) and
 * `structure-resume-text.ts` (local structured parse).
 */

export const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
export const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;
export const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i;
/** Personal site / portfolio domains (excludes linkedin and common email hosts). */
export const WEBSITE_RE =
    /\b(?:https?:\/\/)?(?:www\.)?(?!linkedin\.com)(?!gmail\.com)(?!yahoo\.com)(?!hotmail\.com)(?!outlook\.com)([a-z0-9][-a-z0-9.]*\.(?:xyz|dev|io|me|app|co|com|net|org|ca))\b/i;

const KNOWN_PLACE_WORDS = new Set([
    "ontario", "quebec", "alberta", "manitoba", "saskatchewan", "british columbia",
    "california", "texas", "new york", "florida", "washington", "colorado", "georgia",
    "massachusetts", "illinois", "pennsylvania", "virginia", "arizona", "ohio",
    "canada", "united states", "usa", "uk", "united kingdom", "england", "scotland",
    "india", "australia", "germany", "france", "ireland", "singapore", "buffalo",
    "richmond hill", "toronto", "vancouver", "montreal", "chicago", "boston",
]);

const PREPOSITION_START_RE =
    /^(into|across|while|shipping|with|for|from|through|during|after|before|by|as|and|or|the|a|an)\b/i;

const SUMMARY_VERB_RE =
    /\b(translate|translates|translated|shipping|shipped|owned|deliver|delivered|build|built|manage|managed|lead|led|drive|drove|conceive|conceived|assess|assessed|ship|prioritize|prioritized|currently|enterprise|portfolio|roadmap|roadmaps)\b/i;

const ABBREV_END_RE = /\b(?:Inc|Ltd|Co|Dr|Mr|Mrs|Ms|St|Jr|Sr|Ph\.?D|M\.?B\.?A|M\.?S|B\.?S)\.\s*$/i;

function segmentHasKnownPlace(segment: string): boolean {
    const lower = segment.toLowerCase();
    for (const word of KNOWN_PLACE_WORDS) {
        if (lower.includes(word)) return true;
    }
    return false;
}

/** True when `segment` looks like a city/region/country fragment, not prose. */
export function looksLikeRealPlaceSegment(segment: string): boolean {
    const s = segment.trim();
    if (!s || s.length < 3 || s.length > 80) return false;
    if (EMAIL_RE.test(s) || PHONE_RE.test(s) || LINKEDIN_RE.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return false;
    if (/^\+?\d[\d\s().-]{6,}$/.test(s)) return false;
    if (/[.!?]$/.test(s) && !ABBREV_END_RE.test(s)) return false;
    if (PREPOSITION_START_RE.test(s)) return false;
    const words = s.split(/\s+/);
    if (words.length >= 8 && !segmentHasKnownPlace(s)) return false;
    if (SUMMARY_VERB_RE.test(s) && words.length >= 5) return false;
    if (segmentHasKnownPlace(s)) return true;
    if (/,/.test(s)) {
        const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
        if (
            parts.length >= 2 &&
            parts.length <= 3 &&
            parts.every((p) => p.length <= 40 && /^[A-Za-z][A-Za-z .'-]*$/.test(p))
        ) {
            return true;
        }
    }
    return false;
}

function isContactSegment(segment: string): boolean {
    const s = segment.trim();
    if (!s) return false;
    if (EMAIL_RE.test(s) || PHONE_RE.test(s) || LINKEDIN_RE.test(s)) return true;
    if (WEBSITE_RE.test(s)) return true;
    return looksLikeRealPlaceSegment(s);
}

/** True when a line is a contact row (email/phone/linkedin/website/place), not summary prose. */
export function isContactOrPlaceLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const segments = trimmed.split(/[·|•]/).map((s) => s.trim()).filter(Boolean);
    if (segments.some((seg) => isContactSegment(seg))) return true;
    return isContactSegment(trimmed);
}

/**
 * Drop summary fragments mixed into an otherwise-valid contact row
 * (`into prioritized, shippable roadmaps. | +1 (437)… | email`).
 */
export function sanitizeContactLine(line: string | undefined | null): string | null {
    const trimmed = (line ?? "").trim();
    if (!trimmed) return null;
    const segments = trimmed.split(/[·|•]/).map((s) => s.trim()).filter(Boolean);
    if (segments.length <= 1) {
        return isContactSegment(trimmed) ? trimmed : null;
    }
    return buildContactLine(segments.map((seg) => (isContactSegment(seg) ? seg : "")));
}

/** Drop summary fragments mistakenly stored as location; keep real places only. */
export function sanitizeLocation(location: string | undefined | null): string {
    const trimmed = (location ?? "").trim();
    if (!trimmed) return "";
    if (!looksLikeRealPlaceSegment(trimmed)) return "";
    return trimmed.replace(/^[\s·|•]+|[\s·|•]+$/g, "").trim();
}

export function extractWebsite(text: string): string {
    const re = new RegExp(WEBSITE_RE.source, "gi");
    const matches = [...text.matchAll(re)];
    for (const m of matches) {
        const raw = m[0];
        const lower = raw.toLowerCase();
        if (lower.includes("linkedin.com")) continue;
        return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    }
    return "";
}

/** Build a pipe-delimited contact line, omitting empty segments. */
export function buildContactLine(parts: (string | undefined | null)[]): string | null {
    const filtered = parts.map((p) => (p ?? "").trim()).filter(Boolean);
    return filtered.length > 0 ? filtered.join(" | ") : null;
}
