/**
 * Anonymous search depth cap (P27 shield): unauthenticated searches can page
 * through at most `ANON_MAX_PAGES` pages of results before hitting a gate.
 * Signed-in users are uncapped.
 *
 * `ANON_PAGE_SIZE` mirrors the UI's own page size (`PAGE` in
 * src/app/page.tsx, currently 30) — not imported from there (page.tsx is a
 * page component with no exports, out of this module's ownership) but must
 * be kept in sync if that constant ever changes.
 */
export const ANON_PAGE_SIZE = 30;
export const ANON_MAX_PAGES = 3;
/** First offset an anonymous request is no longer allowed to reach. */
export const ANON_MAX_OFFSET = ANON_PAGE_SIZE * ANON_MAX_PAGES;

/** Copy for the gated response's `note` — same "create a free account"
 *  moment the rest of the app's auth gates use, just reached from search
 *  depth instead of a credit/action gate. */
export const ANONYMOUS_DEPTH_GATE_MESSAGE = "Create a free account to see every result.";

export interface DepthCapInput {
  offset: number | undefined;
  limit: number | undefined;
  isAuthed: boolean;
}

export interface DepthCapDecision {
  /** True when this request must be refused outright — its offset alone is
   *  already past the anonymous window, so nothing should be served. */
  gated: boolean;
  /** The limit to actually send to the backend: unchanged (including
   *  `undefined`, letting the backend apply its own default) when authed,
   *  clamped so `offset + effectiveLimit` never crosses `ANON_MAX_OFFSET`
   *  otherwise, `0` when gated. */
  effectiveLimit: number | undefined;
}

/**
 * Pure decision — the single source of truth for "signed-in users: uncapped."
 * Authed requests pass `limit` through completely unchanged, exactly as if
 * this cap didn't exist. Anonymous requests are windowed to the first
 * `ANON_MAX_PAGES` pages of results regardless of how the caller chunks
 * offset/limit — a single request with a huge `limit` is clamped exactly
 * like a deep `offset` is gated, so the cap can't be skipped by asking for
 * one big page instead of many small ones.
 */
export function resolveDepthCap(input: DepthCapInput): DepthCapDecision {
  if (input.isAuthed) return { gated: false, effectiveLimit: input.limit };
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(0, input.limit ?? ANON_PAGE_SIZE);
  if (offset >= ANON_MAX_OFFSET) return { gated: true, effectiveLimit: 0 };
  return { gated: false, effectiveLimit: Math.min(limit, ANON_MAX_OFFSET - offset) };
}
