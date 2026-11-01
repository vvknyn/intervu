/**
 * Which rows of the roles next to a typed title a list ranked by fit keeps. A title search reads them past its own
 * rows when it ranks by fit (`JobSearchParams.relatedPreview`, `PublicJob.relatedPreview`); this decides which of
 * them the list holds. One rule for the site's Best match list and the agent's for_you list.
 */
import { matchBand, type MatchScore } from "../match/score";
import type { PublicJob } from "./types";

/**
 * Every row but a related preview is kept. A related preview is kept only when it fits the résumé as Strong or Good:
 * on the live index (2026-11-01, 23 titles, first 40 rows each) related rows were Strong or Good 11% of the time
 * (67 of 622) against 25% for the title's own rows (193 of 777), so a related role earns a place among the title
 * matches only when it fits this person. The rest are not listed (they are not what was searched for).
 */
export function keepsRelatedRow(job: PublicJob, score: MatchScore | null | undefined): boolean {
    if (!job.relatedPreview) return true;
    if (!score) return false;
    const band = matchBand(score.total);
    return band === "strong" || band === "good";
}
