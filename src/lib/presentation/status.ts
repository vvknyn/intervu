/**
 * One seeker-facing status vocabulary, so UI copy and (future) email copy
 * read from the SAME words+tone instead of each surface picking its own.
 *
 * Deliberately NOT a fresh set of labels: `GHOST_META` (lib/jobs/
 * presentation.ts) already owns the clear/caution/likely_ghost copy the row
 * badge and detail-panel banner render, and `LISTING_STATE_TEXT`
 * (lib/ui/status-tokens.ts) already owns the relisted tone the fact-chip and
 * disclosure sentence use. This module composes those two existing sources
 * into one lookup rather than writing a third copy of either — if either
 * upstream label changes, this map changes with it by construction.
 *
 * "review" is this module's name for the ghost ladder's "caution" state
 * (`GHOST_META.caution`) — the word a seeker-facing surface actually wants
 * ("this needs a review") rather than the internal enum value.
 */
import { GHOST_META } from "@/lib/jobs/presentation";
import { LISTING_STATE_TEXT } from "@/lib/ui/status-tokens";

export type PresentationStatus = "clear" | "relisted" | "review" | "likely_ghost";

export interface StatusVocabularyEntry {
  /** Seeker-facing word, e.g. "Actively posted". */
  label: string;
  /** Tone — a CSS class string from the same tone source the badge/chip it
   *  was derived from already uses. */
  tone: string;
}

export const STATUS_VOCABULARY: Record<PresentationStatus, StatusVocabularyEntry> = {
  clear: { label: GHOST_META.clear!.label, tone: GHOST_META.clear!.cls },
  review: { label: GHOST_META.caution!.label, tone: GHOST_META.caution!.cls },
  likely_ghost: { label: GHOST_META.likely_ghost!.label, tone: GHOST_META.likely_ghost!.cls },
  // No GHOST_META counterpart — "relisted" is a listing-integrity state
  // (posting-freshness.ts's `classifyRelisted`), not a ghost verdict. Tone
  // borrowed from the one place that already draws a relisted color
  // (LISTING_STATE_TEXT); label is new because nothing upstream states it as
  // a plain sentence-ready word today.
  relisted: { label: "Recently relisted", tone: LISTING_STATE_TEXT.relisted },
};

/** `PublicJob["ghost_badge"]`'s four values, mapped onto this vocabulary.
 *  `unscored` has no seeker-facing word — same "never fabricate a verdict
 *  that didn't happen" contract `GHOST_META.unscored: null` already keeps. */
export const GHOST_BADGE_STATUS: Record<"clear" | "caution" | "likely_ghost" | "unscored", PresentationStatus | null> = {
  clear: "clear",
  caution: "review",
  likely_ghost: "likely_ghost",
  unscored: null,
};
