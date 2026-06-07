/**
 * Status → design-token class chokepoint.
 *
 * Before this module, every surface that rendered a status pill (applications
 * page, dashboard context badges, prep "context active", jobs ghost badge,
 * question difficulty) hardcoded raw Tailwind palette classes like
 * `bg-blue-100 text-blue-700`. Those:
 *   - ignored the design-system `--st-*` tokens,
 *   - had NO dark-mode variant (pale-bg + dark-text is unreadable on dark), and
 *   - drifted independently across files.
 *
 * Everything now resolves through ONE map keyed by a small semantic vocabulary.
 * The classes reference the token utilities wired in globals.css
 * (`--color-st-*` / `--color-st-*-soft`), which already carry both light and
 * dark values, so a single class string is correct in both themes.
 *
 * Pure module — no React, no DOM — so it is unit-testable in isolation.
 */

/** The semantic status vocabulary every UI status maps onto. */
export type StatusTone = "saved" | "applied" | "intv" | "offer" | "closed";

/** Soft-background pill: soft tinted bg + colored foreground + matching border. */
export const STATUS_PILL: Record<StatusTone, string> = {
  saved: "bg-st-saved-soft text-st-saved border border-st-saved/20",
  applied: "bg-st-applied-soft text-st-applied border border-st-applied/20",
  intv: "bg-st-intv-soft text-st-intv border border-st-intv/20",
  offer: "bg-st-offer-soft text-st-offer border border-st-offer/20",
  closed: "bg-st-closed-soft text-st-closed border border-st-closed/20",
};

/** Solid round icon-chip: same soft bg, colored glyph (no border). */
export const STATUS_ICON_CHIP: Record<StatusTone, string> = {
  saved: "bg-st-saved-soft text-st-saved",
  applied: "bg-st-applied-soft text-st-applied",
  intv: "bg-st-intv-soft text-st-intv",
  offer: "bg-st-offer-soft text-st-offer",
  closed: "bg-st-closed-soft text-st-closed",
};

/**
 * Application lifecycle status → tone.
 * `interviewing` → intv, `rejected`/`withdrawn` → closed (both terminal-negative).
 */
export function applicationStatusTone(
  status: "applied" | "interviewing" | "offer" | "rejected" | "withdrawn" | string,
): StatusTone {
  switch (status) {
    case "applied":
      return "applied";
    case "interviewing":
      return "intv";
    case "offer":
      return "offer";
    case "rejected":
    case "withdrawn":
      return "closed";
    default:
      return "saved";
  }
}

/**
 * Question difficulty → tone. Ascending difficulty maps to ascending
 * "heat": junior→applied (blue/calm), mid→intv (amber), senior→intv,
 * staff+/director+→closed (red/hot). Kept on the shared token scale so the
 * difficulty pills are dark-mode correct.
 */
export function difficultyTone(
  difficulty: "junior" | "mid" | "senior" | "staff+" | "director+" | string,
): StatusTone {
  switch (difficulty) {
    case "junior":
      return "offer"; // green = approachable
    case "mid":
      return "applied"; // blue = standard
    case "senior":
      return "intv"; // amber = stretch
    case "staff+":
    case "director+":
      return "closed"; // red = hardest
    default:
      return "saved";
  }
}

/** Ghost-badge → tone. clear→offer (good), caution/likely_ghost→intv (warn). */
export function ghostBadgeTone(
  badge: "clear" | "caution" | "likely_ghost" | "unscored" | string,
): StatusTone | null {
  switch (badge) {
    case "clear":
      return "offer";
    case "caution":
    case "likely_ghost":
      return "intv";
    default:
      return null; // unscored → no chip
  }
}
