/**
 * "+N" on the packs home's pack chips: how many more roles a pack holds than
 * at the visitor's last visit, from the chip counts this device last saw.
 *
 * Same sitting rule as the Today header (`resolveTodaySince`): a return
 * within `TODAY_SESSION_GAP_MS` of the last settle is the same sitting and
 * keeps that sitting's baseline, so going into a pack and back (or a reload)
 * never zeroes the deltas; a later return measures from the last settle.
 *
 * Only exact counts compare. A floor ("31+") or a count read for another
 * résumé or pack never makes a delta, and a shrink is never shown.
 */
import type { CorpusCount } from "@/lib/jobs/corpus-count";
import type { ScoredHubHit } from "@/lib/jobs/for-you/hub-counts";
import { HUB_PACK_IDS, type HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { hubChipCounts } from "@/lib/jobs/for-you/hub-tiles";
import { visibleIndustryTiles } from "@/lib/jobs/for-you/industry-tiles";
import { TODAY_SESSION_GAP_MS } from "@/lib/jobs/for-you/today";
import type { PublicJob } from "@/lib/jobs/types";
import type { IndustryId } from "@/lib/jobs/resume-industry";

/**
 * v2: a chip counts the roles its list opens with (`hubChipCounts`), not the roles its search found (v1), so counts
 * written under v1 are a different number and are never compared with these.
 */
export const HUB_TILE_COUNTS_KEY = "velai.hub.tileCounts.v2";

export type HubPackCounts = Partial<Record<HubPackId, number>>;

export interface HubTileCountMemory {
    /** Whose counts: the résumé and pack they were read for. */
    key: string;
    /** The last settle. */
    lastAt: string;
    counts: HubPackCounts;
    /** This sitting's baseline: the previous sitting's last counts, or `null` on a first visit. */
    since: { at: string; counts: HubPackCounts } | null;
}

/** The exact counts among a pack's chip counts. */
export function exactHubCounts(counts: Partial<Record<HubPackId, CorpusCount | null | undefined>>): HubPackCounts {
    const out: HubPackCounts = {};
    for (const id of HUB_PACK_IDS) {
        const c = counts[id];
        if (c?.kind === "exact" && Number.isFinite(c.value) && c.value >= 0) out[id] = Math.floor(c.value);
    }
    return out;
}

/** What the hub's probe read: the pack's scored rows, its search total, and each filter tile's own rows (null when that read failed). */
export interface HubProbeRead {
    scored: ScoredHubHit[];
    poolTotal: number | null;
    tiles: Partial<Record<HubPackId, ScoredHubHit[] | null>>;
}

/**
 * The exact counts to remember once the probe has read every chip: the chips the hub shows (a hidden tile's "+N" would
 * have nowhere to go), each counting the roles its list opens with and leaving out the roles already in the tracker,
 * so it is read once the tracker is (`hubCountsGate`).
 */
export function chipCountsToRemember(
    read: HubProbeRead & { industry: IndustryId; isTracked: (job: PublicJob) => boolean; nowMs: number },
): HubPackCounts {
    const { industry, scored, poolTotal, tiles, isTracked, nowMs } = read;
    const counts = hubChipCounts({ pack: scored, tiles, isTracked, nowMs, settled: true });
    const shown = new Set(
        visibleIndustryTiles(industry, {
            counts,
            wholePack: poolTotal != null && scored.length >= poolTotal,
            foundNothing: poolTotal === 0,
            settled: true,
        }),
    );
    return Object.fromEntries(Object.entries(exactHubCounts(counts)).filter(([id]) => shown.has(id as HubPackId))) as HubPackCounts;
}

export interface HubCountsGate<T> {
    /** The probe has read every chip count; `value` is what it read. */
    settled(value: T): void;
    /** The tracker has loaded, or is loading again. */
    tracker(loaded: boolean): void;
    /** A newer probe took over: this one's counts are never remembered. */
    cancel(): void;
}

/**
 * Remembering a visit's counts needs two things that finish in either order: the probe's last chip count and the
 * tracker's read (a chip leaves out the roles already in it). `commit` runs once, with what the probe read, the
 * moment both are in, whichever came last. A tracker that loads after the probe settles must not cost the visit its
 * counts, or the next visit has nothing to compare with and no chip can say "+N".
 */
export function hubCountsGate<T>(commit: (value: T) => void, trackerLoaded: boolean): HubCountsGate<T> {
    let loaded = trackerLoaded;
    let read: { value: T } | null = null;
    let closed = false;
    const run = () => {
        if (closed || !loaded || !read) return;
        const { value } = read;
        closed = true;
        read = null;
        commit(value);
    };
    return {
        settled(value) {
            if (closed) return;
            read = { value };
            run();
        },
        tracker(next) {
            loaded = next;
            run();
        },
        cancel() {
            closed = true;
            read = null;
        },
    };
}

export function resolveHubCountDeltas(
    memory: HubTileCountMemory | null,
    key: string,
    current: HubPackCounts,
    nowMs: number,
): { deltas: HubPackCounts; next: HubTileCountMemory } {
    const nowIso = new Date(nowMs).toISOString();
    if (!memory || memory.key !== key) {
        return { deltas: {}, next: { key, lastAt: nowIso, counts: current, since: null } };
    }
    const lastMs = Date.parse(memory.lastAt);
    const sameSitting = Number.isFinite(lastMs) && nowMs - lastMs < TODAY_SESSION_GAP_MS;
    const since = sameSitting ? memory.since : { at: memory.lastAt, counts: memory.counts };
    const deltas: HubPackCounts = {};
    for (const id of HUB_PACK_IDS) {
        const now = current[id];
        const then = since?.counts[id];
        if (now == null || then == null) continue;
        if (now > then) deltas[id] = now - then;
    }
    return { deltas, next: { key, lastAt: nowIso, counts: current, since } };
}

export function readHubTileCounts(): HubTileCountMemory | null {
    try {
        const raw = globalThis.localStorage?.getItem(HUB_TILE_COUNTS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as HubTileCountMemory;
        return parsed && typeof parsed.key === "string" && parsed.counts && typeof parsed.counts === "object" ? parsed : null;
    } catch {
        return null;
    }
}

export function writeHubTileCounts(memory: HubTileCountMemory): void {
    try {
        globalThis.localStorage?.setItem(HUB_TILE_COUNTS_KEY, JSON.stringify(memory));
    } catch {
        /* private mode / quota: the chips simply show no deltas */
    }
}
