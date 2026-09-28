/**
 * Short URLs with no page of their own. Signed-out production hits were 404s.
 * Each destination is a surface that already renders signed-out — not a new
 * product, and not the Search / For you deck.
 *
 * `/packs` is the Job Packs front door, which already lives at `/jobs`.
 * `/apply` follows the retired `/applications` path to the signed-out tracker.
 */
export const SIGNED_OUT_SHORT_REDIRECTS = [
  { source: "/packs", destination: "/jobs" },
  { source: "/apply", destination: "/yours" },
] as const;
