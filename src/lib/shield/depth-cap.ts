/**
 * Anonymous search depth cap (P27 shield): unauthenticated searches can page
 * through at most `ANON_MAX_PAGES` pages of results before hitting a gate.
 * Signed-in users are uncapped. Browse SERP is public; deep pagination signs in.
 *
 * `ANON_PAGE_SIZE` mirrors the UI's own page size (`PAGE` in
 * src/app/jobs/page.tsx, currently 30).
 */
export const ANON_PAGE_SIZE = 30;
export const ANON_MAX_PAGES = 3;
/** First offset an anonymous request is no longer allowed to reach. */
export const ANON_MAX_OFFSET = ANON_PAGE_SIZE * ANON_MAX_PAGES;

export const ANONYMOUS_DEPTH_GATE_MESSAGE = "Create a free account to see every result.";

export interface DepthCapInput {
  offset: number | undefined;
  limit: number | undefined;
  isAuthed: boolean;
}

export interface DepthCapDecision {
  /** True when this request must be refused — offset already past the anon window. */
  gated: boolean;
  /** Limit sent to the backend; `0` when gated. */
  effectiveLimit: number | undefined;
}

/**
 * Pure decision — signed-in users pass through unchanged; anonymous requests
 * are windowed to the first `ANON_MAX_PAGES` pages.
 */
export function resolveDepthCap(input: DepthCapInput): DepthCapDecision {
  if (input.isAuthed) return { gated: false, effectiveLimit: input.limit };
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(0, input.limit ?? ANON_PAGE_SIZE);
  if (offset >= ANON_MAX_OFFSET) return { gated: true, effectiveLimit: 0 };
  return { gated: false, effectiveLimit: Math.min(limit, ANON_MAX_OFFSET - offset) };
}
