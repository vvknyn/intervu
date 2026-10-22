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

/** Drops the trailing "(…)" aside; keeps the " — matches…" fit claim when it fits, else only the lead clause. */
function compactDetail(label: string, detail: string): string {
    const trimmed = detail.replace(/\s*\([^()]*\)\s*$/, "");
    const whole = `${label}: ${trimmed}`;
    return whole.length <= ROW_REASON_MAX ? whole : `${label}: ${trimmed.split(" — ")[0]}`;
}

/**
 * The compact line under a recommended role that says why it is there: a résumé role its title overlaps, else
 * the best-evidenced thing the fit compared ("Relevance: 7 of 12 terms this role names"). Nothing when neither
 * is strong: a row never claims a reason it does not have. A component's `detail` loses a trailing parenthetical,
 * then (only if still over the bound) its " — verdict" tail, the same for every kind; the full sentence stays in the detail pane's "Why this fits".
 */
export function rowReasonLine(job: PublicJob, score: MatchScore | null | undefined, resume: ResumeData | null): string | null {
    if (!score) return null;
    const overlap = deckOverlapTitle(job, resume);
    if (overlap) return bounded(`Title overlap · ${overlap}`);
    const best = score.components
        .filter((component) => !component.unknown && component.score >= SAYABLE_MIN)
        .sort((a, b) => b.score - a.score)[0];
    return best ? bounded(compactDetail(best.label, best.detail)) : null;
}
