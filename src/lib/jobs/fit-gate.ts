import type { CorpusCount } from "@/lib/jobs/corpus-count";

/** How many ranked matches a signed-out visitor sees, with reasons, before the gate. */
export const FIT_GUEST_PREVIEW_ROWS = 3;

export interface FitGateSplit<T> {
    /** What to render: the whole list, or just the free preview. */
    visible: T[];
    /** True only when there is genuinely more than the preview to unlock. */
    gated: boolean;
    /** The true match total to name in the gate — null when the response carried none. */
    count: CorpusCount | null;
}

/**
 * The résumé-fit gate: a guest who has uploaded a résumé sees their top
 * `FIT_GUEST_PREVIEW_ROWS` ranked matches; the rest of the list needs an
 * account. Never gates a list that fits in the preview, and never before the
 * list is actually ranked (`ranked`) — an unranked "top 3" would be a lie.
 */
export function splitFitGate<T>(input: {
    fitActive: boolean;
    ranked: boolean;
    signedOut: boolean;
    rows: T[];
    total: CorpusCount;
}): FitGateSplit<T> {
    const { fitActive, ranked, signedOut, rows, total } = input;
    const gated = fitActive && ranked && signedOut && (rows.length > FIT_GUEST_PREVIEW_ROWS || total.value > FIT_GUEST_PREVIEW_ROWS);
    return {
        visible: gated ? rows.slice(0, FIT_GUEST_PREVIEW_ROWS) : rows,
        gated,
        count: gated && total.value > 0 ? total : null,
    };
}
