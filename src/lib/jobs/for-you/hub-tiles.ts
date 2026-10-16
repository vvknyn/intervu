/**
 * What a packs-hub tile opens for a candidate with a résumé, and what its chip counts. A tile opens its own filters,
 * and its chip counts the roles that list opens with: the deck's own rule applied to the rows that list's search
 * returns (`hubList`), so a chip is never a promise the deck breaks.
 *
 * A filter tile is the résumé's pack (`packFilters`) with the tile's own board filter on top: the deck is that search,
 * "Edit filters" opens /jobs on it, and the chip counts what the deck lists of that search's rows. A row tile has no
 * board filter (AI, Tech for good, Lead, 1-Click apply): it opens the pack's list showing only the rows
 * `jobMatchesHubPack` keeps, and counts those rows among the pack's listed roles.
 */
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import { hubList, HUB_PACK_CORPUS_COUNT_LOADING, formatHubPackCorpusRoleLabel, type ScoredHubHit } from "@/lib/jobs/for-you/hub-counts";
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
 * The count on every chip of a résumé visitor's hub: the roles its list opens with. "All your matches" and each row tile
 * count the pack's own rows; a filter tile counts its own search's rows (`tiles`: absent while that read is in flight,
 * `null` when it failed). While the pack's rows are still arriving (`settled` false) a pack's count is a floor, since
 * more rows may still list.
 */
export function hubChipCounts(input: {
    pack: readonly ScoredHubHit[];
    tiles: Partial<Record<HubPackId, readonly ScoredHubHit[] | null>>;
    isTracked?: (job: PublicJob) => boolean;
    nowMs: number;
    settled: boolean;
}): Partial<Record<HubPackId, CorpusCount | null>> {
    const { pack, tiles, isTracked, nowMs, settled } = input;
    const listed = hubList(pack, nowMs, { isTracked }).jobs;
    const out: Partial<Record<HubPackId, CorpusCount | null>> = {};
    for (const id of HUB_PACK_IDS) {
        if (id === "all") {
            out[id] = { kind: settled ? "exact" : "floor", value: listed.length };
        } else if (isHubFilterTile(id)) {
            const rows = tiles[id];
            if (rows === undefined) continue;
            out[id] = rows === null ? null : { kind: "exact", value: hubList(rows, nowMs, { isTracked }).jobs.length };
        } else {
            out[id] = { kind: settled ? "exact" : "floor", value: listed.filter((job) => jobMatchesHubPack(job, id, nowMs)).length };
        }
    }
    return out;
}

/**
 * Chip labels for a résumé visitor: "15 roles", "14+ roles" while counting, "…" for a chip still waiting on its count
 * (`loading` is before any of the pack's rows are in), and none for a filter tile whose read failed, never a number from
 * a different search.
 */
export function resumeTileLabels(
    counts: Partial<Record<HubPackId, CorpusCount | null>>,
    loading: boolean,
): Partial<Record<string, string>> {
    const labels: Partial<Record<string, string>> = {};
    for (const id of HUB_PACK_IDS) {
        const count = counts[id];
        labels[id] = count === null ? "" : loading || count === undefined ? HUB_PACK_CORPUS_COUNT_LOADING : formatHubPackCorpusRoleLabel(count);
    }
    return labels;
}
