/**
 * Where a job description says the person must be: "candidates must be based
 * in India", "open to applicants located in the EU", "must be authorized to
 * work in the United States", "This is a remote role in Canada",
 * "Location: Remote (Brazil)". A remote posting whose title and place fields
 * name no country used to read as open to anyone, so a role for people in
 * India was a Today pick for a résumé in Canada (2026-10-02).
 *
 * Only sentences that state a requirement count. Offices, headquarters and
 * customers named in passing ("offices in London and Bangalore") never do,
 * and neither does a sentence that lifts the limit ("you don't need to be
 * based in the US", "based anywhere"). A place counts only when the whole
 * phrase is one (`placeNamed`, or the caller's `resolveCity` for a city);
 * a phrase with a place inside other words counts for nothing.
 *
 * Isomorphic and pure: the server passes a gazetteer-backed `resolveCity`.
 */
import { placeNamed } from "./resume-location";
import type { PlaceRestriction } from "./types";

/** The most rows one place-notes request reads: Today checks its first picks, not a page. */
export const PLACE_NOTES_MAX_IDS = 24;

/** A city or other place `placeNamed` doesn't know, to the canonical country it is in. */
export type ResolvePlace = (phrase: string) => string | null;

const PLACE_TEXT = String.raw`([^.;:!?\n()]{2,80})`;

/** Requirement sentences, each capturing the place phrase that follows. */
const REQUIREMENT_PATTERNS: RegExp[] = [
    // "must be based in", "need to reside in", "are required to be located within"
    new RegExp(
        String.raw`\b(?:must|should|will need to|need to|needs to|are required to|is required to|required to)\s+(?:currently\s+|already\s+)?(?:be\s+)?(?:physically\s+)?(?:based|located|living|residing|reside|live)\s+(?:in|within)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "open to candidates based in", "available only to residents of", "only accepting applicants located in"
    new RegExp(
        String.raw`\b(?:open|available|limited|restricted|accepting\s+applications?)\s+(?:only\s+)?(?:to|from)\s+(?:candidates|applicants|residents|people|individuals|those|talent)\s+(?:who\s+(?:are|live|reside)\s+)?(?:currently\s+)?(?:based\s+|located\s+|living\s+|residing\s+)?(?:in|within|of)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "authorized to work in", "eligible to work in", "the right to work in"
    new RegExp(
        String.raw`\b(?:(?:legally\s+)?(?:authori[sz]ed|eligible|entitled|permitted)|(?:the\s+)?right)\s+to\s+work\s+(?:in|within)\s+` + PLACE_TEXT,
        "gi",
    ),
    // "This is a remote role based in", "The position is fully remote within", "this job is remote in"
    new RegExp(
        String.raw`\b(?:this|the)\s+(?:is\s+an?\s+)?(?:(?:fully|100%)\s+)?(?:remote\s+)?(?:role|position|job|opportunity)\s+(?:is\s+)?(?:(?:fully|100%)\s+)?(?:remote\s+)?(?:based\s+)?(?:in|within)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "remote within the US", "remote across Europe", "remote, US only"
    new RegExp(String.raw`\bremote\s+(?:within|across|throughout)\s+` + PLACE_TEXT, "gi"),
    // "Location: Remote (India)" on its own line
    /(?:^|\n)\s*(?:job\s+|work\s+)?location\s*[:\-–]\s*([^\n]{2,80})/gi,
];

/** Words before a requirement that lift it: "you don't need to be based in", "regardless of where". */
const LIFTED = /(?:\b(?:not|no need|never|regardless|wherever|irrespective)\b|n['’]t\b)[^.!?\n]*$/i;

/** Where a place phrase stops: the next clause ("India and will report to…"). */
const CLAUSE_BREAK = /\s+(?:with|who|whom|to|for|where|while|that|which|as|at|during|on|by|and\s+(?:will|be|have|are|must)|unless|except|without|excluding|but)\s+/i;

function stripHtml(text: string): string {
    return text
        .replace(/<\s*(?:br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/[ \t]+/g, " ");
}

/** The places one captured phrase names: "the US or Canada", "India", "EMEA", "Toronto". */
function phrasePlaces(phrase: string, resolvePlace?: ResolvePlace): PlaceRestriction[] {
    const out: PlaceRestriction[] = [];
    const pieces = phrase
        .split(/\s+(?:or|and|&)\s+|[,/|]|\s[-–—]\s/i)
        .map((piece) => piece.split(CLAUSE_BREAK)[0]!.trim())
        .filter(Boolean);
    for (const piece of pieces) {
        if (/\banywhere\b|\bworld\b|\bglobal(?:ly)?\b/i.test(piece)) return [];
        if (piece.split(/\s+/).length > 5) continue;
        const named = placeNamed(piece);
        if (named) {
            out.push(named);
            continue;
        }
        const country = resolvePlace?.(piece.replace(/^(?:the|remote)\s+/i, ""));
        if (country) out.push({ label: country, countries: [country] });
    }
    return out;
}

/** The place a description limits the role to, or `null` when it states no such requirement. */
export function readPlaceRestriction(description: string | null | undefined, resolvePlace?: ResolvePlace): PlaceRestriction | null {
    if (!description) return null;
    const text = stripHtml(description);
    const found: PlaceRestriction[] = [];
    for (const pattern of REQUIREMENT_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            const before = text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
            if (LIFTED.test(before) || LIFTED.test(match[0].slice(0, match[0].length - match[1]!.length))) continue;
            const isLocationLine = /location\s*[:\-–]/i.test(match[0]);
            const places = isLocationLine
                ? match[1]!.split(/[(),;|]|\s[-–—]\s|\s+or\s+/i).flatMap((piece) => phrasePlaces(piece, resolvePlace))
                : phrasePlaces(match[1]!, resolvePlace);
            found.push(...places);
        }
    }
    if (found.length === 0) return null;
    const countries = [...new Set(found.flatMap((place) => place.countries))];
    const labels = [...new Set(found.map((place) => place.label))];
    return { label: labels.slice(0, 3).join(" or "), countries };
}
