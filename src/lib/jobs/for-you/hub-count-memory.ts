/**
 * Session/localStorage last-seen hub pack counts.
 * Diff on probe settle to surface honest removals ("2 left Fully remote").
 * Never invent shrinks — only when a prior known count goes down.
 */
import {
    HUB_PACK_IDS,
    HUB_PACK_SHORT_LABELS,
    type HubPackId,
} from "@/lib/jobs/for-you/hub-pack-filters";

export const HUB_COUNT_MEMORY_KEY = "velai.hub.packCounts.v1";
/** Per-tab snapshot of counts at first hub probe this session — survives Strict Mode remount writes. */
export const HUB_COUNT_BASELINE_KEY = "velai.hub.packCounts.baseline.v1";

export type HubCountMemory = {
    updatedAt: string;
    packs: Partial<Record<HubPackId, { strong: number; good: number }>>;
};

function storage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

export function readHubCountMemory(): HubCountMemory | null {
    const s = storage();
    if (!s) return null;
    try {
        const raw = s.getItem(HUB_COUNT_MEMORY_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as HubCountMemory;
        if (!parsed || typeof parsed !== "object" || !parsed.packs) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeHubCountMemory(snapshot: HubCountMemory): void {
    const s = storage();
    if (!s) return;
    try {
        s.setItem(HUB_COUNT_MEMORY_KEY, JSON.stringify(snapshot));
    } catch {
        /* private mode / quota */
    }
}

/**
 * Baseline for removal diffs this tab session.
 * Captures localStorage memory once (before probe writes) so React Strict Mode
 * remounts still diff against the pre-probe snapshot, not the just-written totals.
 */
export function readHubCountBaseline(): HubCountMemory | null {
    if (typeof globalThis.sessionStorage === "undefined") {
        return readHubCountMemory();
    }
    try {
        const raw = globalThis.sessionStorage.getItem(HUB_COUNT_BASELINE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as HubCountMemory;
            if (parsed && typeof parsed === "object" && parsed.packs) return parsed;
        }
        const mem = readHubCountMemory();
        globalThis.sessionStorage.setItem(
            HUB_COUNT_BASELINE_KEY,
            JSON.stringify(mem ?? { updatedAt: new Date().toISOString(), packs: {} }),
        );
        return mem;
    } catch {
        return readHubCountMemory();
    }
}


export type HubPackRemoval = {
    packId: HubPackId;
    left: number;
    label: string;
};

/**
 * Compare previous remembered band totals to the newly settled probe.
 * Only emits when strong+good shrinks for a pack that had a prior known count.
 */
export function diffHubPackRemovals(
    previous: HubCountMemory | null | undefined,
    nextPacks: Partial<Record<HubPackId, { strong: number; good: number }>>,
): HubPackRemoval[] {
    if (!previous?.packs) return [];
    const out: HubPackRemoval[] = [];
    for (const packId of HUB_PACK_IDS) {
        const prev = previous.packs[packId];
        const next = nextPacks[packId];
        if (!prev || !next) continue;
        const prevTotal = Math.max(0, Math.floor(prev.strong) + Math.floor(prev.good));
        const nextTotal = Math.max(0, Math.floor(next.strong) + Math.floor(next.good));
        if (prevTotal <= 0) continue;
        if (nextTotal >= prevTotal) continue;
        const left = prevTotal - nextTotal;
        if (left <= 0) continue;
        out.push({
            packId,
            left,
            label: HUB_PACK_SHORT_LABELS[packId],
        });
    }
    return out;
}

/** Compact Swiss line: "2 left Fully remote · 1 left Added this week" */
export function formatHubRemovalsLine(removals: HubPackRemoval[]): string {
    if (!removals.length) return "";
    return removals
        .slice(0, 4)
        .map((r) => `${r.left} left ${r.label}`)
        .join(" · ");
}
