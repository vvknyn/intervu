import type { PublicJob } from "@/lib/jobs/types";

export interface HydratedPack {
    job: PublicJob;
    descriptionPending: boolean;
}

/**
 * What a deck pack's hydration state honestly is when no `hydratedJobs` map
 * entry exists for it yet — the single chokepoint ForYouDeck consults for
 * EVERY rendered pack (the active one and every peeking neighbour, not just
 * the one or two a fetch has been dispatched for). A missing entry is NOT
 * "fetched and empty": it means either a fetch hasn't resolved yet, or one
 * was never even dispatched (a peeking card past the deck's fetch lookahead
 * never gets one). Both collapse honestly to "still pending" UNLESS the
 * pack's own description already arrived some other way (e.g. the initial
 * search hit already carried it) — that case is "content", not "loading",
 * so a card never waits on a fetch it doesn't need.
 */
export function resolveDescriptionHydration(pack: PublicJob, entry: HydratedPack | undefined): HydratedPack {
    if (entry) return entry;
    return { job: pack, descriptionPending: pack.description === undefined };
}
