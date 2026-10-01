import type { CorpusCount } from "./corpus-count";
import type { PostedBucket } from "./types";
import { DEFAULT_URL_STATE } from "./url-state";

/**
 * The posted-bucket default is a deliberate product rule (see
 * `DEFAULT_URL_STATE.postedBucket`, url-state.ts — 90 days since
 * 2026-09-30, 30 before) — not a bug. But it hides real inventory
 * (measured 2026-08-12 under the old 30-day default: 2,294 roles shown vs
 * ~7,199 matching roles in the corpus, a ~68% hidden share), which reads as
 * us having a smaller corpus than we do. The fix is to surface the hidden
 * count with a one-click reveal ("show all").
 *
 * The affordance only ever describes what the DEFAULT window hides: it is
 * gated on `activeBucket === DEFAULT_URL_STATE.postedBucket`, and its text
 * names that window's day count, so the two can't drift apart when the
 * default moves again. A visitor who picked a narrower window on purpose
 * (e.g. `?posted=30d`) chose to hide the rest and gets no nudge.
 *
 * `show`/`extra`: the results-count line's ONE decision for whether that
 * affordance renders and what number (if any) it prints. jobs/page.tsx
 * renders this result only — it never re-derives the show/hide logic
 * itself, so the four exclusion rules below can't drift between page.tsx
 * and any other future consumer.
 */
export interface BeyondWindowDecision {
    show: boolean;
    /** `null` when `show` is true but a floor on either side means the
     *  true "extra" count can't be trusted as an exact number — the
     *  affordance still renders, just without a number (see
     *  `resolveCorpusCount`'s `floor` kind). */
    extra: number | null;
}

const HIDDEN: BeyondWindowDecision = { show: false, extra: null };

/** Day count of the default posted window, for the affordance's wording. */
const DEFAULT_WINDOW_DAYS: Partial<Record<PostedBucket, number>> = { "1d": 1, "3d": 3, "7d": 7, "30d": 30, "90d": 90 };
const DEFAULT_WINDOW_PHRASE = `${DEFAULT_WINDOW_DAYS[DEFAULT_URL_STATE.postedBucket ?? "90d"] ?? 90} days`;

/**
 * `activeBucket` — the posted-bucket filter currently applied.
 * `currentCount` — the honest count of the ACTIVE (filtered) search, e.g.
 *   the 90d-filtered total. `null` while unresolved.
 * `beyondCount` — the honest count of the same search with the posted-
 *   bucket filter lifted (the probe request page.tsx fires alongside the
 *   ghost-hidden-count probe). `null` while unresolved or on probe failure
 *   — a failed/absent probe must never fabricate a number, so it hides the
 *   affordance entirely rather than guessing.
 */
export function resolveBeyondWindow(
    activeBucket: PostedBucket | undefined,
    currentCount: CorpusCount | null,
    // `undefined` (the probe hasn't resolved for the CURRENT search yet)
    // is treated the same as `null` (resolved, not applicable) for this
    // show/extra decision — page.tsx's `beyondWindowPending` is what tells
    // the two apart for the "reserve height while we wait" render concern;
    // this function only ever needs to know "is there a decidable number".
    beyondCount: CorpusCount | null | undefined,
): BeyondWindowDecision {
    if (activeBucket === undefined || activeBucket !== DEFAULT_URL_STATE.postedBucket) return HIDDEN;
    if (currentCount === null || beyondCount == null) return HIDDEN;
    if (currentCount.kind === "floor" || beyondCount.kind === "floor") {
        // Either side hit the corpus-count cap — `beyondCount` is always a
        // superset of `currentCount` (same query, wider window), so a floor
        // on either side means real "more" exists, it just can't be stated
        // as an exact number without risking a wrong one.
        return { show: true, extra: null };
    }
    const extra = beyondCount.value - currentCount.value;
    if (extra <= 0) return HIDDEN;
    return { show: true, extra };
}

/**
 * Text for the "N more beyond 90 days" affordance, from an already-
 * resolved `BeyondWindowDecision.extra`. A sentence that names a count
 * must never render without the count (Vivek, 2026-09-17) — this is the
 * ONE place that turns `extra` into words, so page.tsx never interpolates
 * around a hole itself:
 *  - `undefined` — the probe for this search hasn't resolved yet; render
 *    nothing (the caller reserves one line of height instead, so the row
 *    doesn't jump the list below it the moment this resolves).
 *  - `null` — resolved, but `resolveBeyondWindow` hit the corpus-count cap
 *    on either side with no exact number to report (`floor`) — e.g. the
 *    unqueried landing search, whose "beyond 90 days" population is the
 *    whole corpus and blows past the cap with no facet sum to recover an
 *    exact figure from. The affordance still needs an honest sentence,
 *    just not a fabricated number — phrased to read naturally next to the
 *    "· Show all" the render site appends after it, same as the counted form.
 *  - a number — the exact count. `resolveBeyondWindow` already excludes
 *    zero/negative before ever returning `show: true`, but this stays
 *    defensive rather than trusting the caller to have done that.
 */
export function formatBeyondWindowText(extra: number | null | undefined): string | null {
    if (extra === undefined) return null;
    if (extra === null) return `More roles beyond ${DEFAULT_WINDOW_PHRASE}`;
    if (extra <= 0) return null;
    return `${extra.toLocaleString()} more beyond ${DEFAULT_WINDOW_PHRASE}`;
}
