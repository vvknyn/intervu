import type { CorpusCount } from "./corpus-count";

/**
 * Pure decision for the board "posted since your last visit" banner
 * (`BoardVisitBanner.tsx`). Kept separate from the component so the honesty
 * gate — never claim "since your last visit" to someone who has no prior
 * visit on record — is unit-testable without mounting React or stubbing
 * localStorage/server actions.
 *
 * `count` is a `CorpusCount` (not a bare number) because `countNewSinceAction`
 * resolves through the same saturation-aware chokepoint every other search
 * count does (see `corpus-count.ts`) — a capped "new since" count is still
 * `value: 100_000`, `kind: "floor"`, and this gate only cares whether that
 * value is >= 1, regardless of kind.
 */
export function resolveVisitBannerState(input: { hasCursor: boolean; count: CorpusCount }): "hidden" | "shown" {
  return input.hasCursor && input.count.value >= 1 ? "shown" : "hidden";
}
