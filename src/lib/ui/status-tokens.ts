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

/** Solid proportion-bar fill — same tone scale, no soft bg/border. */
export const STATUS_FILL: Record<StatusTone, string> = {
  saved: "bg-st-saved",
  applied: "bg-st-applied",
  intv: "bg-st-intv",
  offer: "bg-st-offer",
  closed: "bg-st-closed",
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

/** Fit verdict → tone. strong→offer (green), stretch→intv (amber), weak→closed (red). */
export function fitVerdictTone(
  verdict: "strong" | "stretch" | "weak" | string,
): StatusTone {
  switch (verdict) {
    case "strong":
      return "offer";
    case "stretch":
      return "intv";
    case "weak":
      return "closed";
    default:
      return "saved";
  }
}

/**
 * Ghost-badge → tone. clear→offer (green, good), caution→intv (amber,
 * review), likely_ghost→closed (red, possible ghost), unscored→null (no
 * chip). Previously caution and likely_ghost shared one amber tone —
 * collapsing "review" and "possible ghost" into the same color hid the
 * worse verdict from every consumer (radar bars, mix bands).
 *
 * Overloaded so the three REAL verdicts return a non-null `StatusTone`:
 * only `unscored` (and an unrecognized string) has no tone, and a caller
 * naming a real badge shouldn't need a `!` to say so. That matters because
 * `GHOST_META` (lib/jobs/presentation.ts) now builds its pill classes
 * through this function instead of hand-picking a second STATUS_PILL entry
 * per badge — the drift that let `likely_ghost` stay amber here for every
 * badge-rendering surface long after the radar/mix-band consumers were
 * fixed to red.
 */
export function ghostBadgeTone(badge: "clear" | "caution" | "likely_ghost"): StatusTone;
export function ghostBadgeTone(badge: string): StatusTone | null;
export function ghostBadgeTone(
  badge: "clear" | "caution" | "likely_ghost" | "unscored" | string,
): StatusTone | null {
  switch (badge) {
    case "clear":
      return "offer";
    case "caution":
      return "intv";
    case "likely_ghost":
      return "closed";
    default:
      return null; // unscored → no chip
  }
}

/**
 * Listing-state vocabulary (ITEM Q, 2026-08-15 — Vivek: "a different color
 * for reported, a different one for relisted, really fresh jobs"). A
 * SEPARATE scale from the ghost ladder above (`ghostBadgeTone`'s
 * clear/caution/likely_ghost stays untouched) — this one describes a
 * listing's posting-integrity/moderation state, not a ghost verdict, and
 * the jobs surfaces that render it (SERP row fact chips, JobDetail's fact
 * chips, the ghost-check ledger's freshness line) already hand-pick raw
 * Tailwind classes rather than the `--st-*` CSS-var tokens STATUS_PILL
 * above uses, so this map matches THAT palette instead of introducing a
 * second token system into an already-Tailwind-literal surface.
 *
 * `reported` is deliberately an outline (no filled bg) — `ghostBadgeTone`'s
 * `likely_ghost` pill is a soft-filled `bg-st-closed-soft`, and reusing that
 * same weight for "someone flagged this" would read as the same verdict.
 */
export type ListingStateTone = "fresh" | "relisted" | "reported";

/** Chip idiom (border + bg + text) — SERP row FACT_BOX, JobDetail's fact chips. */
export const LISTING_STATE_CHIP: Record<ListingStateTone, string> = {
  fresh: "border-sky-200/90 bg-sky-50/90 text-sky-950 dark:border-sky-900/70 dark:bg-sky-950/60 dark:text-sky-200",
  relisted: "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  reported: "border border-red-300 bg-transparent text-red-800 dark:border-red-800 dark:text-red-300",
};

/** Chip idiom's bold uppercase key-label sub-color (the `<b>pay</b>`-style tag). */
export const LISTING_STATE_CHIP_LABEL: Record<ListingStateTone, string> = {
  fresh: "text-sky-600 dark:text-sky-400",
  relisted: "text-violet-700 dark:text-violet-400",
  reported: "text-red-700 dark:text-red-400",
};

/** Plain inline-text idiom — prose notes and the ghost-check ledger's per-signal lines (no box). */
export const LISTING_STATE_TEXT: Record<ListingStateTone, string> = {
  fresh: "text-sky-700 dark:text-sky-400",
  relisted: "text-violet-700 dark:text-violet-400",
  reported: "text-red-700 dark:text-red-400",
};
