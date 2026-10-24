/**
 * Drop ladder rungs OpenRouter no longer serves. `:free` slugs are withdrawn
 * without notice; a withdrawn slug 404s at call time and costs a round-trip
 * (the live search test lost 4 s on one). The public catalog lists what is
 * served, so a rung absent from it is dead by construction.
 *
 * Catalog is fail-open: if it cannot be read the ladder is kept — a failed
 * catalog call must never make the ladder emptier.
 *
 * OpenRouter rungs are also trimmed to models with at least one
 * zero-data-retention endpoint (OpenRouter's public ZDR list), because a model
 * without one would only error. This is an optimisation, not the guarantee:
 * every OpenRouter request carries provider.zdr=true (providers.ts) and
 * OpenRouter enforces it. So the list is fail-open like the catalog: unreadable
 * => rungs kept. Rungs for any other provider are never filtered by it.
 */
import type { LadderRung } from "./model-ladder";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
export const CATALOG_TTL_MS = 60 * 60_000;
const ZDR_URL = "https://openrouter.ai/api/v1/endpoints/zdr";
const CATALOG_TIMEOUT_MS = 3_000;

async function fetchZdrModels(): Promise<Set<string>> {
    const res = await fetch(ZDR_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`zdr ${res.status}`);
    const body = (await res.json()) as { data?: { model_id?: unknown }[] };
    const ids = (body.data ?? []).map((e) => e.model_id).filter((id): id is string => typeof id === "string");
    if (!ids.length) throw new Error("zdr list empty");
    return new Set(ids);
}

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

/** One fetch per process per TTL; a failed fetch resolves null and is retried on the next call. */
function ttlCached<T>(): (load: () => Promise<T>, now: number) => Promise<T | null> {
    let cached: { at: number; value: Promise<T | null> } | null = null;
    resetters.push(() => {
        cached = null;
    });
    return (load, now) => {
        if (cached && now - cached.at < CATALOG_TTL_MS) return cached.value;
        const entry = { at: now, value: load().catch(() => null) };
        cached = entry;
        void entry.value.then((v) => {
            if (!v && cached === entry) cached = null;
        });
        return entry.value;
    };
}

const resetters: (() => void)[] = [];
const liveCatalog = ttlCached<Set<string>>();
const liveZdr = ttlCached<Set<string>>();

/** Pure: on OpenRouter, models without a zero-data-retention endpoint are dropped (they would only error). Other providers and an unknown list keep every rung. */
export function keepZdrRungs(rungs: readonly LadderRung[], zdr: ReadonlySet<string> | null, provider = "openrouter"): LadderRung[] {
    if (!zdr || provider !== "openrouter") return [...rungs];
    return rungs.filter((r) => zdr.has(r.model));
}

export async function liveRungs(
    rungs: readonly LadderRung[],
    provider = "openrouter",
    load: () => Promise<Set<string>> = fetchCatalog,
    now: number = Date.now(),
    loadZdr: () => Promise<Set<string>> = fetchZdrModels,
): Promise<LadderRung[]> {
    return keepZdrRungs(dropDeadRungs(rungs, await liveCatalog(load, now)), await liveZdr(loadZdr, now), provider);
}

/** Test-only. */
export function resetLiveCatalog(): void {
    resetters.forEach((r) => r());
}
