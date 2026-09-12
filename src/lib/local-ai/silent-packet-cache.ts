/**
 * Browser-only silent-packet cache — tailored drafts stay on-device.
 */

import type { TailorDraft } from "./tailor-resume";

export const SILENT_PACKET_CACHE_KEY = "velai.localAi.silentPacket";
export const MAX_SILENT_PACKET_CACHE_ENTRIES = 10;

interface CachedSilentPacketEntry {
    draft: TailorDraft;
    cachedAt: string;
}

interface SilentPacketStore {
    entries: Record<string, CachedSilentPacketEntry>;
    order: string[];
}

function getStorage(): Storage | null {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
}

function readStore(): SilentPacketStore {
    const storage = getStorage();
    if (!storage) return { entries: {}, order: [] };
    try {
        const raw = storage.getItem(SILENT_PACKET_CACHE_KEY);
        if (!raw) return { entries: {}, order: [] };
        const parsed = JSON.parse(raw) as SilentPacketStore;
        if (!parsed?.entries || !Array.isArray(parsed.order)) {
            return { entries: {}, order: [] };
        }
        return parsed;
    } catch {
        return { entries: {}, order: [] };
    }
}

function writeStore(store: SilentPacketStore): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.setItem(SILENT_PACKET_CACHE_KEY, JSON.stringify(store));
    } catch {
        // Private browsing / quota — best-effort only.
    }
}

export function readSilentPacketCache(cacheKey: string): TailorDraft | null {
    const store = readStore();
    const entry = store.entries[cacheKey];
    return entry?.draft ?? null;
}

export function writeSilentPacketCache(cacheKey: string, draft: TailorDraft): void {
    const store = readStore();
    store.entries[cacheKey] = {
        draft,
        cachedAt: new Date().toISOString(),
    };
    store.order = store.order.filter((key) => key !== cacheKey);
    store.order.push(cacheKey);

    while (store.order.length > MAX_SILENT_PACKET_CACHE_ENTRIES) {
        const evict = store.order.shift();
        if (evict) delete store.entries[evict];
    }

    writeStore(store);
}

export function clearSilentPacketCacheForTests(): void {
    const storage = getStorage();
    if (!storage) return;
    try {
        storage.removeItem(SILENT_PACKET_CACHE_KEY);
    } catch {
        // ignore
    }
}
