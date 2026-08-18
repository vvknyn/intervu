/**
 * Credit-pack pricing — single source of truth for the waitlist action's
 * `packId` validation (a future `/pricing` paid tier renders from this same
 * table rather than a hand-copied JSX block).
 *
 * Per-action costs live in `lib/llm/credit-gate.ts` (`CREDITS_PER_ACTION`) —
 * not here. This file previously carried a second, fictional cost table
 * (`ACTION_COSTS`: tailor/fit/prep/cover at different weights) that never
 * matched the real charge path (`chargeIfSharedKey` → `consumeCredit`, always
 * exactly one credit) and named actions (tailor/fit/prep/cover) that moved to
 * MCP-only or were never wired to any UI. Removed rather than patched to
 * avoid two cost tables disagreeing again.
 */
export const PACKS = [
  { id: "starter", usd: 5, credits: 60 },
  { id: "hunt", usd: 12, credits: 180 },
  { id: "deep", usd: 19, credits: 350 },
] as const;

export type Pack = (typeof PACKS)[number];
export type PackId = Pack["id"];
