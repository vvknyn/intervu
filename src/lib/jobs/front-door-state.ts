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
 * Whether the front-door résumé-upload band should render. One rule reused
 * at both its mount sites (desktop under the masthead, mobile inside the
 * results flatMap) so they can't drift apart — the band only ever shows at
 * rest, and only when `needsResumeEntry` says this visitor doesn't have a
 * usable résumé on record yet.
 */
export function showsFrontDoorBand(input: {
    atRest: boolean;
    signedIn: boolean;
    resumeOnFile: boolean | null;
    fitActive: boolean;
}): boolean {
    return input.atRest && needsResumeEntry(input);
}

/**
 * The job-packs hub greeting, derived from real state only. The hub renders
 * for signed-out visitors too, so it never says "Welcome back" (that claims a
 * prior visit we do not know about) and never says "tailored to your
 * background" when there is no résumé to tailor to.
 */
export function hubGreeting(input: {
    signedIn: boolean;
    userName?: string | null;
    hasResume: boolean;
}): { title: string; subtitle: string } {
    const firstName = input.userName?.trim().split(/\s+/)[0] || null;
    const title = input.signedIn
        ? firstName ? `Welcome, ${firstName}` : "Welcome"
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
