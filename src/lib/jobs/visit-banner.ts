/**
 * Pure decision for the board "posted since your last visit" banner
 * (`BoardVisitBanner.tsx`). Kept separate from the component so the honesty
 * gate — never claim "since your last visit" to someone who has no prior
 * visit on record — is unit-testable without mounting React or stubbing
 * localStorage/server actions.
 */
export function resolveVisitBannerState(input: { hasCursor: boolean; count: number }): "hidden" | "shown" {
  return input.hasCursor && input.count >= 1 ? "shown" : "hidden";
}
