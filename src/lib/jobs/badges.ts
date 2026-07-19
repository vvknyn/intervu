/**
 * Pure derivation of the compact row-badge text shown on job rows (Task 8's
 * `GhostChip`, src/app/jobs/page.tsx). Split out from `GHOST_META` (which
 * stays the source of truth for the badge's color/dot styling and the
 * longer descriptive copy in the detail-panel banner) because the `clear`
 * and `caution` badges are functions of wall-clock time, not static strings
 * — keeping that derivation here, decoupled from React/Next client deps,
 * makes it unit-testable without a DOM.
 */
import { formatRelativeAge, STALE_THRESHOLD_MS } from "./freshness";
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
 * Row-badge label contract (Task 8; "live" gated by staleness fix):
 *   clear        → "✓ live {age}" ONLY when updated_at is within
 *                  STALE_THRESHOLD_MS (freshness.ts — the same constant that
 *                  drives the toolbar's amber `isStale` stamp) of `now`.
 *                  Past that threshold, or when updated_at is missing/
 *                  unparseable, the data can't back a liveness claim: render
 *                  the neutral "checked {age}" (or bare "checked" with no
 *                  age at all) instead. One shared threshold means the row
 *                  badge and the toolbar stamp can never contradict each
 *                  other — that drift was the defect being fixed.
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
        case "clear": {
            if (updatedAt == null) return "checked";
            const parsed = Date.parse(updatedAt);
            if (Number.isNaN(parsed)) return "checked";
            const age = formatRelativeAge(updatedAt, nowMs);
            return nowMs - parsed > STALE_THRESHOLD_MS ? `checked ${age}` : `✓ live ${age}`;
        }
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
