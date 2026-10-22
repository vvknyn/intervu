import { formatCorpusCount, type CorpusCount } from "@/lib/jobs/corpus-count";
import { regionDisplayName } from "@/lib/jobs/location-default-preference";
import { needsResumeEntry } from "@/lib/jobs/resume-entry";

/**
 * Whether /jobs is showing its "at rest" front door — search takes center
 * stage, no result row is pre-selected, marketing sits quietly. Deliberately
 * BROADER than `isPristineLanding` (page.tsx): that gate also requires zero
 * active filters and no fit-rank, because it decides whether to show the
 * marketing masthead at all. This one only asks "is there anything to show
 * instead of the empty state" — a typed query, or a deliberately opened job
 * (`?job=`, a real click/deep-link, never the ambient default-browse
 * auto-selection — see `resolveSelectionAfterRefresh`, result-state.ts). A
 * visitor who has only toggled a filter chip (e.g. "remote only") hasn't
 * searched for anything yet, so the centered hero and the band still make
 * sense; the two-pane results layout should not snap in under them just
 * because a facet changed.
 */
export function isAtRest({ query, jobParam }: { query: string; jobParam: string | null }): boolean {
    return !query.trim() && !jobParam;
}

/**
 * What the /jobs front door is made of, by viewer state — the one place that
 * decides it, so a new region joins here and the "one band" rule holds by
 * construction (`band` is a single slot, never a list):
 *  - `rows`: job rows are on screen at once, like every job site. A CONFIRMED
 *    signed-out arrival (`signedOut`, not merely "no user yet") is a reason to list; a signed-in account's reason is its own
 *    résumé-ranked list (the at-rest auto-fit) or its search.
 *  - `band`: the résumé-upload invite — fit is the differentiator, so it is
 *    the only promo at rest; `needsResumeEntry` says who still needs it.
 * The band only ever shows at rest (the caller's `atRest`). Privacy promises, the extension tile and the posting-check pitch are footer
 * links, not regions.
 */
export function frontDoorRegions(input: {
    signedIn: boolean;
    signedOut: boolean;
    resumeOnFile: boolean | null;
    fitActive: boolean;
}): { rows: boolean; band: "resume" | null } {
    return { rows: input.signedOut, band: needsResumeEntry(input) ? "resume" : null };
}

/**
 * The job-packs hub greeting, derived from real state only. The hub renders
 * for signed-out visitors too, so it says "Welcome back" only when this
 * device's own visit record shows an earlier visit (`returning`), never as a
 * guess, and never says "tailored to your background" when there is no résumé
 * to tailor to.
 */
export function hubGreeting(input: {
    signedIn: boolean;
    userName?: string | null;
    hasResume: boolean;
    /** This device opened the packs home in an earlier sitting (`useReturningVisitor`); "back" is never claimed without it. */
    returning?: boolean;
}): { title: string; subtitle: string } {
    const firstName = input.userName?.trim().split(/\s+/)[0] || null;
    const welcome = input.returning ? "Welcome back" : "Welcome";
    const title = input.signedIn
        ? firstName ? `${welcome}, ${firstName}` : welcome
        : input.hasResume ? "Your matches" : "Job packs";
    const subtitle = input.hasResume
        ? "Choose a category below to browse verified roles ranked against your résumé."
        : "Choose a category below to browse verified roles.";
    return { title, subtitle };
}

/**
 * The front door's live line: "1,234 roles posted this week in Canada or
 * remote". The count covers the visitor's country plus remote roles open
 * anywhere (`getFrontDoorWeekCountAction`), so the copy names both; with no
 * country it covers everything and names none.
 */
export function frontDoorWeekCountLine(count: CorpusCount, iso2: string | null): string {
    const n = formatCorpusCount(count);
    const noun = count.kind === "exact" && count.value === 1 ? "role" : "roles";
    const where = iso2 ? ` in ${regionDisplayName(iso2)} or remote` : "";
    return `${n} ${noun} posted this week${where}`;
}
