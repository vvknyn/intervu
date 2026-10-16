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
import { HUB_PACK_IDS, type HubPackId } from "@/lib/jobs/for-you/hub-pack-filters";
import { TODAY_SESSION_GAP_MS } from "@/lib/jobs/for-you/today";

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
