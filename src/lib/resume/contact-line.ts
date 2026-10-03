/**
 * Shared heuristics for résumé contact / location lines — used by
 * `parse-resume-content.ts` (free-text PDF path) and
 * `structure-resume-text.ts` (local structured parse).
 */
import { resumeCountriesFromLocation } from "@/lib/jobs/resume-location";

export const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
/** North-American shape, or any `+`-prefixed international number (`+91 98765 55012`, `+41 44 555 01 23`). */
export const PHONE_RE =
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b|\+\d{1,3}(?:[\s.-]?\(?\d{1,5}\)?){2,5}\b/;
export const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i;
/** Personal site / portfolio domains (excludes linkedin and common email hosts). */
export const WEBSITE_RE =
    /\b(?:https?:\/\/)?(?:www\.)?(?!linkedin\.com)(?!gmail\.com)(?!yahoo\.com)(?!hotmail\.com)(?!outlook\.com)([a-z0-9][-a-z0-9.]*\.(?:xyz|dev|io|me|app|co|com|net|org|ca|ai|design|studio|site|page|tech|info|art|blog|online|portfolio|uk|us))\b/i;

const PREPOSITION_START_RE =
    /^(into|across|while|shipping|with|for|from|through|during|after|before|by|as|and|or|the|a|an)\b/i;

const SUMMARY_VERB_RE =
    /\b(translate|translates|translated|shipping|shipped|owned|deliver|delivered|build|built|manage|managed|lead|led|drive|drove|conceive|conceived|assess|assessed|ship|prioritize|prioritized|currently|enterprise|portfolio|roadmap|roadmaps)\b/i;

const ABBREV_END_RE = /\b(?:Inc|Ltd|Co|Dr|Mr|Mrs|Ms|St|Jr|Sr|Ph\.?D|M\.?B\.?A|M\.?S|B\.?S)\.\s*$/i;

/** A year or a date — a place line never carries one (a postal code is not a year). */
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

/** "Location:", "Based in" … — says the rest of the segment is a place. */
const LOCATION_LABEL_RE = /^(?:(?:location|address|city)\s*:|based (?:in|out of)\b|located in\b)\s*/iu;
const WORK_MODE = String.raw`(?:fully\s+)?(?:remote|hybrid|on-?site)`;
const WORK_MODE_RE = new RegExp(String.raw`\b${WORK_MODE}\b`, "iu");
const WORK_MODE_PAREN_RE = new RegExp(String.raw`\(\s*${WORK_MODE}\s*\)`, "giu");
const WORK_MODE_EDGE_RE = new RegExp(String.raw`^${WORK_MODE}\b|\b${WORK_MODE}$`, "giu");
const EDGE_PUNCT_RE = /^[\s,:;·|•—–-]+|[\s,:;·|•—–-]+$/gu;
/** One comma part of a place: letters in any script, spaces, dots, apostrophes, hyphens. */
const PLACE_PART_RE = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
/** A token carrying a digit — a street number or postal code ("M5V", "94105"). */
const DIGIT_TOKENS_TAIL_RE = /(?:^|\s+)(?:[\p{L}\d-]*\d[\p{L}\d-]*\s*)+$/u;
/** "Greater Toronto Area", "San Francisco Bay Area". */
const AREA_RE = /^\p{Lu}[\p{L}\p{M} .'’-]*\s(?:Area|Region)$/u;

/** Prose, contact data or dates — never a place, whatever else the segment holds. */
function isNotPlaceText(s: string): boolean {
    if (!s || s.length > 80) return true;
    if (EMAIL_RE.test(s) || PHONE_RE.test(s) || LINKEDIN_RE.test(s) || WEBSITE_RE.test(s)) return true;
    if (/^https?:\/\//i.test(s) || YEAR_RE.test(s)) return true;
    if (/[.!?]$/.test(s) && !ABBREV_END_RE.test(s)) return true;
    return PREPOSITION_START_RE.test(s);
}

/** Prose that happens to be comma-shaped ("drove roadmaps, shipped features"). */
function isProse(place: string): boolean {
    const words = place.split(/\s+/).length;
    return words >= 8 || (SUMMARY_VERB_RE.test(place) && words >= 5);
}

/**
 * Pure: the place a segment names, with its decoration stripped — a leading
 * pin or bullet, a "Location:" label, a Remote/Hybrid qualifier, a street
 * number and a postal code. `parts` are its comma parts; empty when the
 * segment is not place-shaped. `marked` is true when a label or work-mode
 * qualifier said "this is where I am".
 */
export function parsePlaceSegment(segment: string | undefined | null): { parts: string[]; marked: boolean } {
    const raw = (segment ?? "").trim();
    const none = { parts: [], marked: false };
    if (isNotPlaceText(raw)) return none;
    let s = raw.replace(/^[^\p{L}\p{N}(]+/u, "");
    const marked = LOCATION_LABEL_RE.test(s) || WORK_MODE_RE.test(s);
    s = s.replace(LOCATION_LABEL_RE, "").replace(WORK_MODE_PAREN_RE, "").replace(WORK_MODE_EDGE_RE, "");
    s = s.replace(EDGE_PUNCT_RE, "");
    s = s.match(/^\((.*)\)$/)?.[1].trim() ?? s;
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    while (parts.length > 0 && /\d/.test(parts[0])) parts.shift();
    if (parts.length > 0) parts[parts.length - 1] = parts[parts.length - 1].replace(DIGIT_TOKENS_TAIL_RE, "");
    const kept = parts.filter(Boolean);
    const shaped = kept.length >= 1 && kept.length <= 3 && kept.every((p) => p.length <= 40 && PLACE_PART_RE.test(p));
    return shaped && !isProse(kept.join(" ")) ? { parts: kept, marked } : none;
}

/** A comma part after the first names a country, state/province or its code (`Ontario`, `TX`, `UK`). */
function namesRegion(parts: string[]): boolean {
    return parts.slice(1).some((p) => /^[A-Z]{2}$/.test(p) || resumeCountriesFromLocation(p).length > 0);
}

/**
 * Stricter than `looksLikeRealPlaceSegment`: a segment is the candidate's
 * place only with evidence — a region/country part (`Austin, TX`,
 * `Zürich, Switzerland`), an "… Area" name, or a label / work-mode
 * qualifier. `TypeScript, React` is not a place.
 */
export function isLikelyPlaceSegment(segment: string): boolean {
    const { parts, marked } = parsePlaceSegment(segment);
    if (parts.length === 0) return false;
    return marked || namesRegion(parts) || (parts.length === 1 && AREA_RE.test(parts[0]));
}

/**
 * A one-part place with none of that evidence ("Mississauga", "London") —
 * or "". Not the candidate's location: the name may be several places, or
 * none ("TypeScript"), until the user confirms which.
 */
export function barePlaceOf(segment: string): string {
    const { parts } = parsePlaceSegment(segment);
    return parts.length === 1 && !isLikelyPlaceSegment(segment) ? parts[0] : "";
}

/** True when `segment` looks like a city/region/country fragment, not prose. */
export function looksLikeRealPlaceSegment(segment: string): boolean {
    const { parts } = parsePlaceSegment(segment);
    return parts.length >= 2 || isLikelyPlaceSegment(segment);
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
    return parsePlaceSegment(location).parts.join(", ");
}

/**
 * The person's own site ("lucja.design", "janedoe.dev"), never a piece of
 * their email address: "lucja.w@example.com" used to give "example.com".
 */
export function extractWebsite(text: string): string {
    const emails = [...text.matchAll(new RegExp(EMAIL_RE.source, "g"))].map((m) => [m.index, m.index + m[0].length]);
    const re = new RegExp(WEBSITE_RE.source, "gi");
    for (const m of text.matchAll(re)) {
        const raw = m[0];
        const lower = raw.toLowerCase();
        if (lower.includes("linkedin.com")) continue;
        const start = m.index;
        const end = start + raw.length;
        if (emails.some(([a, b]) => start < b && end > a)) continue;
        return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    }
    return "";
}

/** Build a pipe-delimited contact line, omitting empty segments. */
export function buildContactLine(parts: (string | undefined | null)[]): string | null {
    const filtered = parts.map((p) => (p ?? "").trim()).filter(Boolean);
    return filtered.length > 0 ? filtered.join(" | ") : null;
}
