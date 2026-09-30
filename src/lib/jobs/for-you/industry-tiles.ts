/**
 * Which pack tiles a résumé visitor sees: the tiles of their profession's
 * industry (`resumeIndustry`), plus "Added this week" and "Pay listed", which
 * mean the same thing in every profession.
 *
 * A tile shows only when it helps: it holds at least `MIN_TILE_ROLES` roles
 * and it narrows the list (under `MAX_TILE_SHARE` of it). A tile that matches
 * nothing ("0 roles") or everything (every listing has an apply link) is
 * hidden, and the industry's next tile takes its place, up to
 * `MAX_PACK_TILES` beside "All your matches". Until the counts settle the
 * visitor sees the industry's first tiles, so the row doesn't start empty.
 */
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import { resumeHubPackCounts } from "@/lib/jobs/for-you/hub-counts";
import type { HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { isHubFilterTile, type HubFilterTileId } from "@/lib/jobs/for-you/hub-tiles";
import type { IndustryId } from "@/lib/jobs/resume-industry";
import type { PublicJob } from "@/lib/jobs/types";

/** Most tiles beside "All your matches". */
export const MAX_PACK_TILES = 6;
/** Fewer roles than this and a tile isn't worth a tap. */
export const MIN_TILE_ROLES = 3;
/** A tile holding this share of the list or more narrows nothing. */
export const MAX_TILE_SHARE = 0.9;
/** Below this many rows in hand, a share says nothing about the list. */
const MIN_ROWS_FOR_SHARE = 10;

/** Tiles every profession gets, shown after the industry's own. */
export const UNIVERSAL_TILE_IDS = ["fresh", "salary"] as const satisfies readonly HubPackId[];

/** Each industry's own tiles, most useful first. */
export const INDUSTRY_TILE_IDS: Record<IndustryId, readonly HubPackId[]> = {
    tech: ["ai", "remote", "lead", "good"],
    health: ["health_lead", "health_part_time", "health_research", "health_community", "health_remote", "health_new_grad"],
    education: ["edu_k12", "edu_higher", "edu_special", "edu_lead", "edu_part_time", "edu_online"],
    business: ["biz_enterprise", "ai", "remote", "biz_lead", "biz_partnerships", "good"],
    finance: ["fin_accounting", "fin_fpa", "fin_banking", "fin_lead", "remote", "contract"],
    office: ["office_hr", "office_exec", "office_health", "remote", "part_time", "contract"],
    trades: ["trades_apprentice", "trades_licensed", "trades_lead", "trades_construction", "trades_maintenance", "trades_manufacturing"],
    logistics: ["log_cdl", "log_local", "log_warehouse", "log_lead", "part_time", "contract"],
    service: ["service_lead", "service_food", "service_retail", "service_support", "part_time", "remote"],
    general: ["remote", "senior_lead", "part_time", "contract"],
};

/** Every tile a résumé in this industry can see, "all" first. */
export function industryTileCandidates(industry: IndustryId): HubPackId[] {
    return ["all", ...INDUSTRY_TILE_IDS[industry], ...UNIVERSAL_TILE_IDS];
}

/** The filter tiles whose own search this industry's hub runs for a count (hub-tiles.ts). */
export function industryFilterTileIds(industry: IndustryId): HubFilterTileId[] {
    return industryTileCandidates(industry).filter((id): id is HubFilterTileId => id !== "all" && isHubFilterTile(id));
}

export type IndustryTileCounts = {
    /** Row tiles: how many of the rows in hand each keeps (`resumeHubPackCounts`). */
    rowCounts: Partial<Record<HubPackId, number>>;
    /** How many of the pack's rows are in hand. */
    rowsInHand: number;
    /** Filter tiles: their own search's total; undefined while counting, null when the read failed. */
    filterCounts: Partial<Record<HubPackId, CorpusCount | null>>;
    /** The pack's total ("All your matches"). */
    allTotal: number | null;
    /** Every count above is final. */
    settled: boolean;
};

/** False only when the counts show the tile holds too few roles or nearly all of them. */
function tileHelps(id: HubPackId, counts: IndustryTileCounts): boolean {
    // No roles in the pack: no tile can hold any, even one whose own count failed.
    if (counts.allTotal === 0) return false;
    if (isHubFilterTile(id)) {
        const count = counts.filterCounts[id];
        // Still counting, or the count failed: a missing number is not a reason to hide a tile.
        if (count == null) return true;
        if (count.value < MIN_TILE_ROLES) return false;
        return !(counts.allTotal != null && counts.allTotal > 0 && count.value / counts.allTotal >= MAX_TILE_SHARE);
    }
    const kept = counts.rowCounts[id] ?? 0;
    if (kept < MIN_TILE_ROLES) return false;
    // A share of a few rows says little, unless those rows are the whole pack: then it is exact.
    const wholePack = counts.allTotal != null && counts.rowsInHand >= counts.allTotal;
    const judged = counts.rowsInHand >= MIN_ROWS_FOR_SHARE || wholePack;
    return !(judged && kept / counts.rowsInHand >= MAX_TILE_SHARE);
}

/**
 * The tiles to show, "all" first, then the industry's own, then the universal
 * ones. Universal tiles that help always show; the industry's fill the rest.
 */
export function visibleIndustryTiles(industry: IndustryId, counts: IndustryTileCounts): HubPackId[] {
    const own = INDUSTRY_TILE_IDS[industry];
    const universal: readonly HubPackId[] = UNIVERSAL_TILE_IDS;
    if (!counts.settled) {
        return ["all", ...own.slice(0, MAX_PACK_TILES - universal.length), ...universal];
    }
    const keptUniversal = universal.filter((id) => tileHelps(id, counts));
    const keptOwn = own.filter((id) => tileHelps(id, counts)).slice(0, MAX_PACK_TILES - keptUniversal.length);
    return ["all", ...keptOwn, ...keptUniversal];
}

/**
 * The hub's tiles from what the probe has so far: the pack's total, the rows in
 * hand (each row tile counts its own among them) and each filter tile's search.
 * Settled once the list total, the probe and every filter tile count are in.
 */
export function hubIndustryTiles(
    industry: IndustryId,
    input: {
        listTotal: CorpusCount | null;
        listJobs: PublicJob[];
        filterCounts: Partial<Record<HubPackId, CorpusCount | null>>;
        probing: boolean;
        nowMs?: number;
    },
): HubPackId[] {
    const rowCounts: Partial<Record<HubPackId, number>> = {};
    if (input.listTotal) {
        const counts = resumeHubPackCounts({ listTotal: input.listTotal, listJobs: input.listJobs, nowMs: input.nowMs });
        for (const [id, count] of Object.entries(counts)) rowCounts[id as HubPackId] = count.value;
    }
    const settled =
        input.listTotal != null &&
        !input.probing &&
        industryFilterTileIds(industry).every((id) => input.filterCounts[id] !== undefined);
    return visibleIndustryTiles(industry, {
        rowCounts,
        rowsInHand: input.listJobs.length,
        filterCounts: input.filterCounts,
        allTotal: input.listTotal?.value ?? null,
        settled,
    });
}
