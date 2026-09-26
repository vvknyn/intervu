import type { PackSections } from "@/lib/jobs/for-you/pack-sections";
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

export type DescriptionPaneState = "loading" | "empty" | "content";

/**
 * What ForYouPack's description pane should show. Pendingness comes ONLY
 * from the `descriptionPending` flag the fetch reports — never from
 * inspecting the shape of `description` itself. A description that is
 * still an empty/falsy value while a fetch is in flight (e.g. `""` before
 * the real copy arrives) must still read as "loading", never fall through
 * to "empty" — that fallthrough was the bug this guards against.
 *
 * Deliberately independent of pack-sections.ts's own logic (only borrows
 * its `PackSections` type): this decision is about pane state, not about
 * how a description gets split into sections.
 */
export function descriptionPaneState(
    descriptionPending: boolean | undefined,
    sections: PackSections,
): DescriptionPaneState {
    if (descriptionPending) return "loading";
    const hasContent =
        sections.about.length + sections.responsibilities.length + sections.requirements.length > 0;
    return hasContent ? "content" : "empty";
}
