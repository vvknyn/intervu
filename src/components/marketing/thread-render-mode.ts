export type ThreadRenderMode = "animated" | "instant";

/**
 * Pure decision for `WhatsAppThreadHero`: play the message-by-message reveal
 * or render the finished thread immediately. `prefersReducedMotion` is
 * framer-motion's `useReducedMotion()` return value — `null` before the
 * media-query listener has attached (SSR / first paint) — which this treats
 * the same as `false` (animate), since most visitors don't have the OS
 * setting on and a hydration flash would be worse than a brief default.
 * Split out from the component (mirrors `proof-band.ts`'s split from
 * `ProofBand.tsx`) so the branch is unit-testable without rendering React.
 */
export function resolveThreadRenderMode(prefersReducedMotion: boolean | null): ThreadRenderMode {
  return prefersReducedMotion ? "instant" : "animated";
}
