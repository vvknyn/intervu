/**
 * On-device engine ladder — init only after user consent.
 *
 * Order: Nano → WebLLM (WebGPU) → Transformers WASM → heuristic rules.
 */

import { nanoEngine } from "./engines/nano";
import { transformersWasmEngine } from "./engines/transformers-wasm";
import { webllmEngine } from "./engines/webllm";
import type { LocalAiEngine, LocalAiEngineId, ModelParseOutput } from "./engines/types";
import { ENGINE_LABELS } from "./engines/types";

const LADDER: LocalAiEngine[] = [nanoEngine, webllmEngine, transformersWasmEngine];

let activeEngine: LocalAiEngine | null = null;
let initPromise: Promise<LocalAiEngine> | null = null;

export function getEngineLabel(id: LocalAiEngineId): string {
    return ENGINE_LABELS[id];
}

export function getActiveEngineId(): LocalAiEngineId {
    return activeEngine?.id ?? "heuristic";
}

export function getActiveEngineLabel(): string {
    return getEngineLabel(getActiveEngineId());
}

/** Probe ladder without downloading — returns first engine that reports available. */
export async function probeBestEngine(): Promise<LocalAiEngineId> {
    for (const engine of LADDER) {
        if (await engine.isAvailable()) return engine.id;
    }
    return "heuristic";
}

/**
 * Init the first available engine in ladder order. Caches singleton.
 * Falls through to heuristic (no throw) if all model inits fail.
 */
export async function initLocalAiLadder(): Promise<LocalAiEngineId> {
    if (activeEngine) return activeEngine.id;
    if (initPromise) return (await initPromise).id;

    initPromise = (async () => {
        for (const engine of LADDER) {
            try {
                if (!(await engine.isAvailable())) continue;
                await engine.init();
                activeEngine = engine;
                return engine;
            } catch (e) {
                console.warn(`[local-ai] ${engine.id} init failed`, e);
            }
        }
        // No model — heuristic only (no download required).
        return null as unknown as LocalAiEngine;
    })();

    await initPromise;
    initPromise = null;
    return getActiveEngineId();
}

/** Parse via active model; null if no model or parse failed. */
export async function parseWithActiveEngine(text: string): Promise<ModelParseOutput> {
    if (!activeEngine) return null;
    try {
        return await activeEngine.parseResumeText(text);
    } catch (e) {
        console.warn("[local-ai] model parse failed", e);
        return null;
    }
}

export function resetLocalAiLadderForTests(): void {
    activeEngine = null;
    initPromise = null;
}
