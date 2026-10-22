import { deckOverlapTitle } from "@/lib/jobs/for-you/deck-detail";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import type { ResumeData } from "@/types/resume";

/** A fit component this good (the fit bands' "Good" cut, 75/100) is worth saying on a row. */
const SAYABLE_MIN = 0.75;

/** The longest a row's reason may run: two lines at a 390px phone. */
export const ROW_REASON_MAX = 60;

function bounded(text: string): string {
    return text.length <= ROW_REASON_MAX ? text : `${text.slice(0, ROW_REASON_MAX - 1).trimEnd()}…`;
}

/**
 * The compact line under a recommended role that says why it is there: a résumé role its title overlaps, else
 * the best-evidenced thing the fit compared ("Relevance: 7 of 12 terms this role names"). Nothing when neither
 * is strong: a row never claims a reason it does not have. A component's `detail` shortens to its lead clause
 * (before " — "), the same for every kind; the full sentence stays in the detail pane's "Why this fits".
 */
export function rowReasonLine(job: PublicJob, score: MatchScore | null | undefined, resume: ResumeData | null): string | null {
    if (!score) return null;
    const overlap = deckOverlapTitle(job, resume);
    if (overlap) return bounded(`Title overlap · ${overlap}`);
    const best = score.components
        .filter((component) => !component.unknown && component.score >= SAYABLE_MIN)
        .sort((a, b) => b.score - a.score)[0];
    return best ? bounded(`${best.label}: ${best.detail.split(" — ")[0]}`) : null;
}
