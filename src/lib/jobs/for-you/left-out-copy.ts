/**
 * What a recommendation list says about the roles it left out, in the same words on every surface (the
 * For You deck's footer and empty state, the MCP `for_you` note): how many, and why, so a short list is
 * a count with a reason, never a list padded with roles that don't fit.
 */
import { PACK_MAX_AGE_DAYS, type DeckLeftOut, type DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import { languageLabel } from "@/lib/match/posting-language";

const REASON_TEXT: Record<DeckLeftOut, string> = {
    level: "above your level",
    requirement: "asking for something your résumé doesn't show",
    language: "written in another language",
    "other-role": "a different kind of role",
    stretch: "a weaker fit",
    abroad: "outside where you can work",
    unplaced: "not clear you can work there",
    old: `posted over ${PACK_MAX_AGE_DAYS} days ago`,
};

/** Ties in count read in this order: the reasons about the person first. */
const REASON_ORDER: readonly DeckLeftOut[] = ["level", "requirement", "language", "other-role", "stretch", "abroad", "unplaced", "old"];

/** "8 written in French", largest first: roles left out for the language they are written in, by that language. */
export function writtenInParts(languages: Readonly<Record<string, number>>): string[] {
    return Object.entries(languages)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([language, count]) => `${count} written in ${languageLabel(language)}`);
}

/** "41 above your level", largest first; a posting left out for its language names it: "8 written in French". */
export function leftOutParts(summary: DeckLeftOutSummary): string[] {
    const parts: { n: number; text: string }[] = [];
    for (const reason of REASON_ORDER) {
        const n = summary.byReason[reason] ?? 0;
        if (n <= 0) continue;
        const written = reason === "language" ? Object.entries(summary.languages ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]) : [];
        if (written.length > 0) for (const [language, count] of written) parts.push({ n: count, text: writtenInParts({ [language]: count })[0]! });
        else parts.push({ n, text: `${n} ${REASON_TEXT[reason]}` });
    }
    return parts.sort((a, b) => b.n - a.n).map((part) => part.text);
}

/** The roles left out and why, or null when the list left none out. */
export function formatLeftOutLine(summary: DeckLeftOutSummary | null | undefined): string | null {
    if (!summary || summary.considered <= 0) return null;
    const parts = leftOutParts(summary);
    if (parts.length === 0) return null;
    return `Left out of the ${summary.considered.toLocaleString()} roles found: ${parts.join(" · ")}`;
}

/**
 * What a list holds: roles that fit, the closest when nothing fit (`near`), roles that fit and were posted over a month
 * ago because no newer one does (`older`), or the closest of those when not even a newer role is close (`older-near`).
 */
export type DeckListKind = "fit" | "near" | "older" | "older-near";

/**
 * The list's own count, at the foot of the deck. The deck gives each employer one card (`collapseByEmployer`), so with
 * `employers` fewer than the roles the count says both: "12 roles fit your résumé at 7 employers".
 */
export function formatDeckShowingLine(listed: number, kind: DeckListKind = "fit", employers?: number): string | null {
    const n = Math.floor(listed);
    if (!Number.isFinite(n) || n <= 0) return null;
    const e = employers != null && Number.isFinite(employers) ? Math.floor(employers) : n;
    const at = e > 0 && e < n ? ` at ${e.toLocaleString()} ${e === 1 ? "employer" : "employers"}` : "";
    if (kind === "near") return `${n.toLocaleString()} closest ${n === 1 ? "role" : "roles"}${at} · each a weaker fit`;
    if (kind === "older-near") return `${n.toLocaleString()} closest ${n === 1 ? "role" : "roles"}${at} · each a weaker fit, all posted over ${PACK_MAX_AGE_DAYS} days ago`;
    if (kind === "older") return `${n.toLocaleString()} ${n === 1 ? "role fits" : "roles fit"} your résumé${at} · all posted over ${PACK_MAX_AGE_DAYS} days ago`;
    return `${n.toLocaleString()} ${n === 1 ? "role fits" : "roles fit"} your résumé${at} · best fit first`;
}

/** Said above the closest roles, when nothing fit: a short list is an honest one, never padded with a fit it does not have. */
export const NEAR_MISS_NOTICE =
    "None of the roles we found fit your résumé well yet. These are the closest: your résumé shows little of what they ask for. Add detail to your résumé (what you did, the tools you used) for closer matches.";

/** Said above the older roles, when no role from the last month fits: they fit, but they may already be filled, and each card says how old it is. */
export const OLDER_FITS_NOTICE = `No role posted in the last ${PACK_MAX_AGE_DAYS} days fits your résumé yet. These fit, but they were posted longer ago and some may already be filled. Each card says how old it is.`;

/** Said above the closest older roles, when nothing newer is even close: a weaker fit, posted longer ago, and each card says how old it is. */
export const OLDER_NEAR_MISS_NOTICE = `None of the roles we found fit your résumé well yet, and nothing posted in the last ${PACK_MAX_AGE_DAYS} days is close. These are the closest, each a weaker fit, posted longer ago, and some may already be filled. Each card says how old it is.`;
