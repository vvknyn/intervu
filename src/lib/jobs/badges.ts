/**
 * Pure derivation of the compact row-badge text shown on job rows (Task 8's
 * `GhostChip`, src/app/jobs/page.tsx). Split out from `GHOST_META` (which
 * stays the source of truth for the badge's color/dot styling and the
 * longer descriptive copy in the detail-panel banner) because the `clear`
 * and `caution` badges are functions of wall-clock time, not static strings
 * — keeping that derivation here, decoupled from React/Next client deps,
 * makes it unit-testable without a DOM.
 */
import { formatRelativeAge } from "./freshness";
import type { GhostBadge } from "./types";

/**
 * Whole days between `postedTs` and `nowMs`, floored at 0 (clock-skew /
 * future-dated sentinels never go negative). `null` when there's no posted
 * timestamp to derive from — callers fall back to a badge without a count.
 */
export function daysOpenFrom(postedTs: number | null, nowMs: number): number | null {
    if (postedTs == null) return null;
    return Math.max(0, Math.floor((nowMs - postedTs) / 86_400_000));
}

/**
 * Row-badge label contract (Task 8):
 *   clear        → "✓ live {relative age of updated_at}"
 *   caution      → "⚠ {daysOpen} days open" (daysOpen derived from posted_ts)
 *   likely_ghost → "✕ likely ghost" (visibility is filtering's job, not this
 *                  function's — it only decides the TEXT for a badge that's
 *                  already on screen)
 *   unscored     → null (no badge — preserves the pre-Task-8 null behavior)
 */
export function badgeFor(
    ghostBadge: GhostBadge,
    updatedAt: string | null,
    postedTs: number | null,
    nowMs: number,
): string | null {
    switch (ghostBadge) {
        case "clear":
            return updatedAt ? `✓ live ${formatRelativeAge(updatedAt, nowMs)}` : "✓ live";
        case "caution": {
            const days = daysOpenFrom(postedTs, nowMs);
            return days != null ? `⚠ ${days} days open` : "⚠ worth verifying";
        }
        case "likely_ghost":
            return "✕ likely ghost";
        case "unscored":
        default:
            return null;
    }
}
