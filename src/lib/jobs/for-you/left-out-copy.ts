/**
 * What a recommendation list says about the roles it left out, in the same words on every surface (the
 * For You deck's footer and empty state, the MCP `for_you` note): how many, and why, so a short list is
 * a count with a reason, never a list padded with roles that don't fit.
 */
import type { DeckLeftOut, DeckLeftOutSummary } from "@/lib/jobs/for-you/band-order";

const REASON_TEXT: Record<DeckLeftOut, string> = {
    level: "above your level",
    requirement: "asking for something your résumé doesn't show",
    "other-role": "a different kind of role",
    stretch: "a weaker fit",
    abroad: "outside where you can work",
    unplaced: "not clear you can work there",
    old: "posted too long ago",
};

/** Ties in count read in this order: the reasons about the person first. */
const REASON_ORDER: readonly DeckLeftOut[] = ["level", "requirement", "other-role", "stretch", "abroad", "unplaced", "old"];

/** "41 above your level", largest first. */
export function leftOutParts(summary: DeckLeftOutSummary): string[] {
    return REASON_ORDER.filter((reason) => (summary.byReason[reason] ?? 0) > 0)
        .sort((a, b) => (summary.byReason[b] ?? 0) - (summary.byReason[a] ?? 0))
        .map((reason) => `${summary.byReason[reason]} ${REASON_TEXT[reason]}`);
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
