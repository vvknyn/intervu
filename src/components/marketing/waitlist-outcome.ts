export type WaitlistOutcome = { kind: "success" } | { kind: "error"; message: string };

/**
 * Turns `joinConnectWaitlist`'s raw response into UI state. Pure so it's
 * unit-testable without rendering React (mirrors `proof-band.ts` keeping its
 * derivation separate from, and tested apart from, `ProofBand.tsx`).
 *
 * `joinConnectWaitlist` is an idempotent upsert keyed on email — a
 * resubmission just re-merges the same doc and returns `{ success: true }`
 * again, so there is no separate "duplicate" outcome to fabricate here: the
 * absence of an error IS success.
 */
export function resolveWaitlistOutcome(res: { error?: string; success?: true }): WaitlistOutcome {
  if (res.error) return { kind: "error", message: res.error };
  return { kind: "success" };
}
