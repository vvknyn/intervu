/**
 * What a packs-hub tile opens for a candidate with a résumé. A tile opens its
 * own filters, and its count comes from the same search as its list.
 *
 * A filter tile is the résumé's pack (`packFilters`) with the tile's own board
 * filter on top: the deck is that search, "Edit filters" opens /jobs on it,
 * and the tile's count is its total. A row tile has no board filter (AI, Tech
 * for good, Lead, 1-Click apply): it opens the pack's list showing only the
 * rows `jobMatchesHubPack` keeps, and counts those rows (`resumeHubPackCounts`).
 */
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import { formatHubPackCorpusRoleLabels, HUB_PACK_CORPUS_COUNT_LOADING } from "@/lib/jobs/for-you/hub-counts";
import { HUB_PACK_IDS, jobMatchesHubPack, type HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import type { PublicJob } from "@/lib/jobs/types";
import type { JobsUrlState } from "@/lib/jobs/url-state";

export type HubTile =
    | { kind: "filter"; state: JobsUrlState }
    | { kind: "rows"; state: JobsUrlState };

export function isHubPackId(id: string): id is HubPackId {
    return (HUB_PACK_IDS as readonly string[]).includes(id);
}

/** Tiles with a board filter of their own ("all" is the pack itself). */
export const HUB_FILTER_TILE_IDS = ["all", "remote", "fresh", "salary"] as const satisfies readonly HubPackId[];
export type HubFilterTileId = (typeof HUB_FILTER_TILE_IDS)[number];

export function isHubFilterTile(id: HubPackId): id is HubFilterTileId {
    return (HUB_FILTER_TILE_IDS as readonly HubPackId[]).includes(id);
}

/** The tile's own filter, on top of the pack's: it replaces the pack's value for that field. */
function filterPatch(pack: JobsUrlState, id: HubFilterTileId): Partial<JobsUrlState> {
    switch (id) {
        case "all":
            return {};
        case "remote":
            return { facets: { ...pack.facets, work_type: ["remote"] } };
        case "fresh":
            return { postedBucket: "7d", postedExplicit: true };
        case "salary":
            // A salary floor of 1 is "a salary is listed" (salary_min or salary_max, meilisearch.ts).
            return { salaryMin: Math.max(pack.salaryMin, 1) };
    }
}

export function hubTile(pack: JobsUrlState, id: HubPackId): HubTile {
    if (!isHubFilterTile(id)) return { kind: "rows", state: pack };
    return { kind: "filter", state: { ...pack, ...filterPatch(pack, id) } };
}

/** The deck rows a tile shows: every row for a filter tile, the matching ones for a row tile. */
export function hubTileRows(jobs: PublicJob[], id: HubPackId | undefined, nowMs: number): PublicJob[] {
    if (!id || isHubFilterTile(id)) return jobs;
    return jobs.filter((job) => jobMatchesHubPack(job, id, nowMs));
}

/**
 * Tile labels for a résumé visitor: the pack's own counts (`resumeHubPackCounts`),
 * with each filter tile labelled from its own search instead. A filter tile
 * whose count has not arrived shows the loading label; one whose read failed
 * shows no count, never a number from a different search.
 */
export function resumeTileLabels(
    packCounts: Partial<Record<HubPackId, CorpusCount>>,
    filterCounts: Partial<Record<HubPackId, CorpusCount | null>>,
    loading: boolean,
): Partial<Record<string, string>> {
    const labels = formatHubPackCorpusRoleLabels(packCounts, { loading });
    for (const id of HUB_FILTER_TILE_IDS) {
        if (id === "all") continue;
        const count = filterCounts[id];
        if (count === undefined) labels[id] = HUB_PACK_CORPUS_COUNT_LOADING;
        else labels[id] = count === null ? "" : formatHubPackCorpusRoleLabels({ [id]: count })[id] ?? "";
    }
    return labels;
}
