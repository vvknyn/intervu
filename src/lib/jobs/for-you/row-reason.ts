import { deckOverlapSentence } from "@/lib/jobs/for-you/deck-detail";
import type { PublicJob } from "@/lib/jobs/types";
import type { MatchScore } from "@/lib/match/score";
import type { ResumeData } from "@/types/resume";

/** A fit component this good (the fit bands' "Good" cut, 75/100) is worth saying on a row. */
const SAYABLE_MIN = 0.75;

/**
 * The one line under a recommended role that says why it is there: a résumé role its title overlaps, else the
 * best-evidenced thing the fit compared ("Relevance: 7 of 12 terms this role names"). Nothing when neither is
 * strong: a row never claims a reason it does not have. The same words the role's card gives under "What we
 * inferred" (`stackInferredRows`), so a row and its detail cannot disagree.
 */
export function rowReasonLine(job: PublicJob, score: MatchScore | null | undefined, resume: ResumeData | null): string | null {
    if (!score) return null;
    const overlap = deckOverlapSentence(job, resume);
    if (overlap) return overlap;
    const best = score.components
        .filter((component) => !component.unknown && component.score >= SAYABLE_MIN)
        .sort((a, b) => b.score - a.score)[0];
    return best ? `${best.label}: ${best.detail}` : null;
}
