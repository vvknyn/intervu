/**
 * Credit-pack pricing — single source of truth for `/pricing` and the
 * waitlist action's `packId` validation. Everything downstream (per-pack
 * card copy, the "~50¢ per application" claim, the packId enum a bot or a
 * typo could otherwise dodge) derives from these two tables rather than
 * being re-typed at each call site.
 */
export const PACKS = [
  { id: "starter", usd: 5, credits: 60 },
  { id: "hunt", usd: 12, credits: 180 },
  { id: "deep", usd: 19, credits: 350 },
] as const;

export type Pack = (typeof PACKS)[number];
export type PackId = Pack["id"];

export const ACTION_COSTS = {
  tailor: 4,
  fit: 2,
  prep: 6,
  cover: 3,
} as const;

export type ActionName = keyof typeof ACTION_COSTS;

/** Credits for one "serious application": a tailored resume + a fit check. */
export const APPLICATION_COST = ACTION_COSTS.tailor + ACTION_COSTS.fit;

/** How many full "serious applications" (tailor + fit) a pack covers. */
export function applicationsPerPack(pack: Pack): number {
  return Math.floor(pack.credits / APPLICATION_COST);
}

/** Format a USD amount the way this page speaks about money: cents below a
 *  dollar ("50¢"), dollars-and-cents at or above it ("$1.50"). */
function formatUsd(usd: number): string {
  if (usd < 1) return `${Math.round(usd * 100)}¢`;
  return `$${usd.toFixed(2)}`;
}

/**
 * The "about fifty cents" line's factual core. Priced at the `starter`
 * pack's per-credit rate (the baseline rate the free-tier copy references)
 * for `APPLICATION_COST` credits — never a hardcoded string, so a change to
 * PACKS or ACTION_COSTS moves this number automatically.
 *
 * starter: $5 / 60 credits; APPLICATION_COST = tailor(4) + fit(2) = 6
 * credits → 5 * 6 / 60 = $0.50 → "50¢".
 */
export function costPerApplication(): string {
  const starter = PACKS.find((p) => p.id === "starter");
  if (!starter) throw new Error("costPerApplication: PACKS has no 'starter' pack");
  // Multiply before dividing so the exact-cent case (e.g. 50¢) isn't left
  // exposed to float error from an intermediate per-credit rate.
  const usd = (starter.usd * APPLICATION_COST) / starter.credits;
  return formatUsd(usd);
}
