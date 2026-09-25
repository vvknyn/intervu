/**
 * Rotating load copy for Job Packs surfaces (hub match probe, for-you deck
 * skeleton, JD hydrate on the postcard). Swiss/Klein calm confidence —
 * encouraging for job seekers, never cute-AI, never "Hang tight while our AI…".
 *
 * Pure module: pools + index math only. The client component owns the timer.
 */

export type PacksLoadingVariant = "hub" | "deck" | "jd";

/** ~3s — inside the 2.5–3.5s product window; one constant so tests stay stable. */
export const PACKS_LOADING_ROTATE_MS = 3000;

/** Shared backbone — light variants below pick from this or a context pool. */
export const PACKS_LOADING_SHARED = [
    "Matching roles to your résumé…",
    "Sorting Strong fits first…",
    "Lining up roles worth your time…",
    "Reading your background against open roles…",
    "Building a shortlist you can trust…",
    "Quiet work — ranking what fits…",
] as const;

export const PACKS_LOADING_HUB = [
    "Counting matches across your packs…",
    "Warming pack counts — Strong first…",
    "Matching roles to your résumé…",
    "Sorting Strong fits first…",
    "Scanning open roles against your profile…",
    "Assembling honest pack totals…",
] as const;

export const PACKS_LOADING_DECK = [
    "Matching roles to your résumé…",
    "Sorting Strong fits first…",
    "Lining up roles worth your time…",
    "Reading your background against open roles…",
    "Building a shortlist you can trust…",
    "Queuing your next Strong fit…",
    "Quiet work — ranking what fits…",
] as const;

export const PACKS_LOADING_JD = [
    "Pulling the fine print on this posting…",
    "Fetching the full job description…",
    "Getting the employer's wording intact…",
    "Loading the full posting…",
    "Reading the role end to end…",
    "Bringing in requirements and context…",
] as const;

const POOLS: Record<PacksLoadingVariant, readonly string[]> = {
    hub: PACKS_LOADING_HUB,
    deck: PACKS_LOADING_DECK,
    jd: PACKS_LOADING_JD,
};

export function packsLoadingPool(variant: PacksLoadingVariant): readonly string[] {
    return POOLS[variant];
}

/** Pure: which line to show at tick `n` (0-based). Advances sequentially. */
export function packsLoadingLine(variant: PacksLoadingVariant, tick: number): string {
    const pool = POOLS[variant];
    const i = ((tick % pool.length) + pool.length) % pool.length;
    return pool[i]!;
}
