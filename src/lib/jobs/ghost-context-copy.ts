/**
 * R7 (2026-08-09 founder report): "we should start saying why a job posting
 * that is a little old could potentially not be a ghost job too — because
 * that could be misleading." Posting age alone must never read as a ghost
 * verdict. One copy source, mounted via the EXISTING `ContextHelp` tooltip
 * pattern (components/ui/context-help.tsx) at every surface that shows
 * posting age as a potentially negative signal — no new tooltip mechanism,
 * no new visual weight (house style).
 *
 * Traced before writing this: `deriveGhostSignals` (job-detail-facts.ts)
 * shows FOUR signal categories in the ghost-verdict panel — freshness/repost
 * history, description substance, and salary disclosure — so "we weigh more
 * than age" is a fact about what this UI already displays, not a claim
 * about the upstream `ghost_badge` field's own scoring internals (opaque to
 * this layer by design — see that field's doc comment, types.ts). The copy
 * below only claims what's independently verifiable from the signal grid
 * itself.
 */
import type { GhostSignal } from "@/components/jobs/job-detail-facts";

export const POSTING_AGE_CONTEXT_COPY =
  "An older posting isn't necessarily inactive — senior and specialized roles can take months to fill, and some companies hire for a role on a rolling basis. We also weigh more than age: repost history, how much the listing actually says, and whether pay is disclosed.";

/** Identifies `deriveGhostSignals`' age-derived line by its `kind`, not by
 *  matching the text it happens to render — "freshness" is the only signal
 *  category driven by posting age. */
export function isAgeSignal(signal: GhostSignal): boolean {
  return signal.kind === "freshness";
}

/**
 * Pure: mount the balance note only when posting age is the LONE negative-
 * marked signal in the displayed grid — every other shown signal is
 * positive, or there simply isn't one. When two or more signals are
 * genuinely negative (e.g. also relisted, also a thin description), the
 * verdict already reflects real multi-signal evidence and this note would
 * only dilute it — the boundary this function exists to enforce (never
 * soften a multi-signal verdict; only add context when age is carrying the
 * negative reading alone).
 */
export function shouldShowAgeBalanceNote(signals: readonly GhostSignal[]): boolean {
  // ITEM T (2026-08-15) hand-excluded `kind === "reposts"` here because that
  // line is a data-absence marker, not a judgment. That carve-out is gone
  // (2026-08-16): `GhostSignalStatus` now says so at the signal itself, so
  // "really negative" is a property every reader gets for free instead of a
  // per-reader exception list that the ghost-check counter never received.
  const negatives = signals.filter((s) => s.status === "unfavorable");
  return negatives.length === 1 && isAgeSignal(negatives[0]);
}
