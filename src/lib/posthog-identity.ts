/**
 * The pure half of analytics identity: given the previously-identified user and
 * the one auth just reported, what should we tell PostHog?
 *
 * Kept separate from PostHogProvider because the interesting case is invisible
 * in production — PostHog's ingest host is a common tracker-blocker target, so
 * "did we call reset() at the right moment" cannot be observed from a browser.
 * As a pure function it is simply testable.
 */
export type IdentityAction = "identify" | "reset" | "none";

export function identityAction(
  previous: string | null,
  next: string | null,
): IdentityAction {
  if (next === previous) return "none";
  if (next) return "identify";
  // Signed out. A null with no previous identity is just the first anonymous
  // callback on page load — resetting there would churn the distinct_id and
  // split one visit into two.
  return previous ? "reset" : "none";
}
