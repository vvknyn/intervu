/**
 * Drop ladder rungs OpenRouter no longer serves. `:free` slugs are withdrawn
 * without notice; a withdrawn slug 404s at call time and costs a round-trip
 * (the live search test lost 4 s on one). The public catalog lists what is
 * served, so a rung absent from it is dead by construction.
 *
 * Fail-open: if the catalog cannot be read the configured ladder is returned
 * unchanged — a failed catalog call must never make the ladder emptier.
 */
import type { LadderRung } from "./model-ladder";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
export const CATALOG_TTL_MS = 60 * 60_000;
const CATALOG_TIMEOUT_MS = 3_000;

/** Pure: free rungs missing from a known catalog are removed; the paid tail and an unknown catalog are never touched. */
export function dropDeadRungs(rungs: readonly LadderRung[], catalog: ReadonlySet<string> | null): LadderRung[] {
    if (!catalog) return [...rungs];
    return rungs.filter((r) => r.isFallback || catalog.has(r.model));
}

async function fetchCatalog(): Promise<Set<string>> {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
    if (!ids.length) throw new Error("catalog empty");
    return new Set(ids);
}

let cached: { at: number; catalog: Promise<Set<string> | null> } | null = null;

/** One catalog fetch per process per TTL; a failed fetch resolves null and is retried on the next call. */
function liveCatalog(load: () => Promise<Set<string>>, now: number): Promise<Set<string> | null> {
    if (cached && now - cached.at < CATALOG_TTL_MS) return cached.catalog;
    const entry = { at: now, catalog: load().catch(() => null) };
    cached = entry;
    void entry.catalog.then((c) => {
        if (!c && cached === entry) cached = null;
    });
    return entry.catalog;
}

export async function liveRungs(
    rungs: readonly LadderRung[],
    load: () => Promise<Set<string>> = fetchCatalog,
    now: number = Date.now(),
): Promise<LadderRung[]> {
    return dropDeadRungs(rungs, await liveCatalog(load, now));
}

/** Test-only. */
export function resetLiveCatalog(): void {
    cached = null;
}
