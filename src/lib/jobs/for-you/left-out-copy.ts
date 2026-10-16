/**
 * What a recommendation list says about the roles it left out, in the same words on every surface (the
 * For You deck's footer and empty state, the MCP `for_you` note): how many, and why, so a short list is
 * a count with a reason, never a list padded with roles that don't fit.
 */
import { PACK_MAX_AGE_DAYS, type DeckLeftOutSummary, type ListLeftOut } from "@/lib/jobs/for-you/band-order";
import { languageLabel } from "@/lib/match/posting-language";

const REASON_TEXT: Record<ListLeftOut, string> = {
    level: "above your level",
    requirement: "asking for something your résumé doesn't show",
    language: "written in another language",
    "other-role": "a different kind of role",
    stretch: "a weaker fit",
    abroad: "outside where you can work",
    unplaced: "not clear you can work there",
    old: `posted over ${PACK_MAX_AGE_DAYS} days ago`,
    closed: "with an apply link that no longer works",
    tracked: "already applied to",
};

/** Ties in count read in this order: the reasons about the person first. */
const REASON_ORDER: readonly ListLeftOut[] = ["level", "requirement", "language", "other-role", "stretch", "abroad", "unplaced", "old", "tracked", "closed"];

/** "8 written in French", largest first: roles left out for the language they are written in, by that language. */
export function writtenInParts(languages: Readonly<Record<string, number>>): string[] {
    return Object.entries(languages)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([language, count]) => `${count} written in ${languageLabel(language)}`);
}

/** The reasons with their counts, largest first; a posting left out for its language names it: "8 written in French". */
function leftOutCounted(summary: DeckLeftOutSummary): { n: number; text: string }[] {
    const parts: { n: number; text: string }[] = [];
    for (const reason of REASON_ORDER) {
        const n = summary.byReason[reason] ?? 0;
        if (n <= 0) continue;
        const written = reason === "language" ? Object.entries(summary.languages ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]) : [];
        if (written.length > 0) for (const [language, count] of written) parts.push({ n: count, text: writtenInParts({ [language]: count })[0]! });
        else parts.push({ n, text: `${n} ${REASON_TEXT[reason]}` });
    }
    return parts.sort((a, b) => b.n - a.n);
}

/** "41 above your level", largest first; a posting left out for its language names it: "8 written in French". */
export function leftOutParts(summary: DeckLeftOutSummary): string[] {
    return leftOutCounted(summary).map((part) => part.text);
}

/** What the line counts: all the roles the search found, or the first rows of them the list has read so far ("the first 150 of 226 roles found"). */
function readOfFound(summary: DeckLeftOutSummary): string {
    const read = summary.considered.toLocaleString();
    return summary.found != null && summary.found > summary.considered
        ? `the first ${read} of ${summary.found.toLocaleString()} roles found`
        : `the ${read} roles found`;
}

/**
 * The roles left out and why, or null when the list left none out. `maxParts` keeps the largest reasons and counts the
 * rest together ("12 for other reasons"), for a place with room for one short line.
 */
export function formatLeftOutLine(summary: DeckLeftOutSummary | null | undefined, options: { maxParts?: number } = {}): string | null {
    if (!summary || summary.considered <= 0) return null;
    const counted = leftOutCounted(summary);
    if (counted.length === 0) return null;
    const max = options.maxParts;
    const shown = max != null && counted.length > max ? counted.slice(0, max) : counted;
    const rest = counted.slice(shown.length).reduce((sum, part) => sum + part.n, 0);
    const parts = [...shown.map((part) => part.text), ...(rest > 0 ? [`${rest.toLocaleString()} for other reasons`] : [])];
    return `Left out of ${readOfFound(summary)}: ${parts.join(" · ")}`;
}

/**
 * What a list holds: roles that fit, the closest when nothing fit (`near`), roles that fit and were posted over a month
 * ago because no newer one does (`older`), or the closest of those when not even a newer role is close (`older-near`).
 */
export type DeckListKind = "fit" | "near" | "older" | "older-near";

/** Which kind of list a summary describes (`deckListFor` marks the fallbacks with `near` and `older`). */
export function deckListKind(summary: Pick<DeckLeftOutSummary, "near" | "older"> | null | undefined): DeckListKind {
    if (summary?.near && summary.older) return "older-near";
    if (summary?.near) return "near";
    if (summary?.older) return "older";
    return "fit";
}

/** The list's own count, at the foot of the deck. */
export function formatDeckShowingLine(listed: number, kind: DeckListKind = "fit"): string | null {
    const n = Math.floor(listed);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (kind === "near") return `${n.toLocaleString()} closest ${n === 1 ? "role" : "roles"} · each a weaker fit`;
    if (kind === "older-near") return `${n.toLocaleString()} closest ${n === 1 ? "role" : "roles"} · each a weaker fit, all posted over ${PACK_MAX_AGE_DAYS} days ago`;
    if (kind === "older") return `${n.toLocaleString()} ${n === 1 ? "role fits" : "roles fit"} your résumé · all posted over ${PACK_MAX_AGE_DAYS} days ago`;
    return `${n.toLocaleString()} ${n === 1 ? "role fits" : "roles fit"} your résumé · best fit first`;
}

/**
 * The packs hub's one count line, in the deck's own words (`formatDeckShowingLine`): what the pack opens with. A pack that
 * read roles and listed none says so rather than showing no count; one that read nothing has no line.
 */
export function formatHubFitLine(summary: DeckLeftOutSummary | null | undefined): string | null {
    if (!summary) return null;
    if (summary.listed > 0) return formatDeckShowingLine(summary.listed, deckListKind(summary));
    return summary.considered > 0 ? "No role fits your résumé yet" : null;
}

/** Said above the closest roles, when nothing fit: a short list is an honest one, never padded with a fit it does not have. */
export const NEAR_MISS_NOTICE =
    "None of the roles we found fit your résumé well yet. These are the closest: your résumé shows little of what they ask for. Add detail to your résumé (what you did, the tools you used) for closer matches.";

/** Said above the older roles, when no role from the last month fits: they fit, but they may already be filled, and each card says how old it is. */
export const OLDER_FITS_NOTICE = `No role posted in the last ${PACK_MAX_AGE_DAYS} days fits your résumé yet. These fit, but they were posted longer ago and some may already be filled. Each card says how old it is.`;

/** Said above the closest older roles, when nothing newer is even close: a weaker fit, posted longer ago, and each card says how old it is. */
export const OLDER_NEAR_MISS_NOTICE = `None of the roles we found fit your résumé well yet, and nothing posted in the last ${PACK_MAX_AGE_DAYS} days is close. These are the closest, each a weaker fit, posted longer ago, and some may already be filled. Each card says how old it is.`;
