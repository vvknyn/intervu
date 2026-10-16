/**
 * What a recommendation list says about the roles it left out, in the same words on every surface (the
 * For You deck's footer and empty state, the MCP `for_you` note): how many, and why, so a short list is
 * a count with a reason, never a list padded with roles that don't fit.
 */
import type { DeckLeftOut, DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";
import { languageLabel } from "@/lib/match/posting-language";

const REASON_TEXT: Record<DeckLeftOut, string> = {
    level: "above your level",
    requirement: "asking for something your résumé doesn't show",
    language: "written in another language",
    "other-role": "a different kind of role",
    stretch: "a weaker fit",
    abroad: "outside where you can work",
    unplaced: "not clear you can work there",
    old: "posted too long ago",
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

/** The list's own count, at the foot of the deck. `near`: nothing fit, these are the closest. */
export function formatDeckShowingLine(listed: number, near = false): string | null {
    const n = Math.floor(listed);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (near) return `${n.toLocaleString()} closest ${n === 1 ? "role" : "roles"} · each a weaker fit`;
    return `${n.toLocaleString()} ${n === 1 ? "role fits" : "roles fit"} your résumé · best fit first`;
}

/** Said above the closest roles, when nothing fit: a short list is an honest one, never padded with a fit it does not have. */
export const NEAR_MISS_NOTICE =
    "None of the roles we found fit your résumé well yet. These are the closest: your résumé shows little of what they ask for. Add detail to your résumé (what you did, the tools you used) for closer matches.";
