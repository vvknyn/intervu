/**
 * Pure derivation of the compact row-badge text shown on job rows (Task 8's
 * `GhostChip`, src/app/jobs/page.tsx). Split out from `GHOST_META` (which
 * stays the source of truth for the badge's color/dot styling and the
 * longer descriptive copy in the detail-panel banner) because the `clear`
 * and `caution` badges are functions of wall-clock time, not static strings
 * — keeping that derivation here, decoupled from React/Next client deps,
 * makes it unit-testable without a DOM.
 */
import { formatRelativeAge, isStale, STALE_CHECK_DAYS, STALE_THRESHOLD_MS } from "./freshness";
import type { GhostBadge } from "./types";

const STALE_CHECK_MS = STALE_CHECK_DAYS * 86_400_000;

/**
 * Is a "clear" (no-ghost-signals) verdict still backed by a CURRENT check?
 * `updated_at` older than `STALE_CHECK_DAYS`, missing, or unparseable all
 * count as stale — a "clear" call from a month-plus-old check isn't a
 * current one, however green it still looks. Exported and unit-tested
 * (tests/unit/jobs-badges.test.ts) so the row badge's text, the row badge's
 * color, and the detail-panel "No ghost signals" banner all read the SAME
 * verdict and can never disagree about which side of "stale" a job is on.
 */
export function checkFreshness(updatedAt: string | null, nowMs: number): "fresh" | "stale" {
    return isStale(updatedAt, nowMs, STALE_CHECK_MS) ? "stale" : "fresh";
}

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
 *                  Past that threshold but within STALE_CHECK_DAYS, or when
 *                  updated_at is missing/unparseable, the data can't back a
 *                  liveness claim: render the neutral "checked {age}" (or
 *                  bare "checked" with no age at all) instead. Past
 *                  STALE_CHECK_DAYS (`checkFreshness` above), even "checked"
 *                  overstates it — "last seen {age}" (or "not recently
 *                  verified" with no parseable age).
 *   caution      → "⚠ {daysOpen} days open" (daysOpen derived from posted_ts)
 *   likely_ghost → "✕ likely ghost" (visibility is filtering's job, not this
 *                  function's — it only decides the TEXT for a badge that's
 *                  already on screen)
 *   unscored     → null (no badge — preserves the pre-Task-8 null behavior)
 */
/**
 * The SERP row's terse trust chip. The row previously collapsed the 4-state
 * `GhostBadge` into one boolean (`flagged = warn|danger`), which put BOTH
 * "clear" and "unscored" in the same else-branch — an unscored job rendered
 * "✓ verified", a verification claim about a check that never ran. Same
 * honesty ladder `badgeFor` above encodes, in chip-sized vocabulary:
 *   caution/likely_ghost → "review"
 *   clear + current check → "verified" (checkFreshness, the shared boundary)
 *   clear + stale check   → "checked" (past tense — the data can't back a
 *                           present-tense claim; see STALE_CLEAR_META)
 *   unscored              → null, NO chip (never fabricate a state — the
 *                           same contract badgeFor's `unscored → null` keeps)
 */
export type RowTrustChip = "review" | "verified" | "checked";

export function rowTrustChip(
    ghostBadge: GhostBadge,
    updatedAt: string | null,
    nowMs: number,
): RowTrustChip | null {
    switch (ghostBadge) {
        case "caution":
        case "likely_ghost":
            return "review";
        case "clear":
            return checkFreshness(updatedAt, nowMs) === "fresh" ? "verified" : "checked";
        case "unscored":
        default:
            return null;
    }
}

export function badgeFor(
    ghostBadge: GhostBadge,
    updatedAt: string | null,
    postedTs: number | null,
    nowMs: number,
): string | null {
    switch (ghostBadge) {
        case "clear": {
            if (checkFreshness(updatedAt, nowMs) === "stale") {
                const parsed = updatedAt == null ? NaN : Date.parse(updatedAt);
                return Number.isNaN(parsed)
                    ? "not recently verified"
                    : `last seen ${formatRelativeAge(updatedAt as string, nowMs)}`;
            }
            // "fresh" guarantees updatedAt parses (checkFreshness treats
            // null/unparseable as stale) — no null/NaN fallback needed here.
            const parsed = Date.parse(updatedAt as string);
            const age = formatRelativeAge(updatedAt as string, nowMs);
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
