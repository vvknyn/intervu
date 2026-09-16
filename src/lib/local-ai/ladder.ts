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

/** Max wait before falling back to heuristic; init continues in background. */
const INIT_TIMEOUT_MS = 10_000;

let activeEngine: LocalAiEngine | null = null;
let initPromise: Promise<LocalAiEngine | null> | null = null;
let initStartedAt: number | null = null;
let initTimedOut = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("local-ai init timeout")), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

async function initFirstAvailableEngine(): Promise<LocalAiEngine | null> {
    for (const engine of LADDER) {
        try {
            if (!(await engine.isAvailable())) continue;
            await engine.init();
            return engine;
        } catch (e) {
            console.warn(`[local-ai] ${engine.id} init failed`, e);
        }
    }
    return null;
}

export function getEngineLabel(id: LocalAiEngineId): string {
    if (id === "heuristic") return ENGINE_LABELS.heuristic;
    if (activeEngine?.id === id) return activeEngine.getDisplayLabel();
    return ENGINE_LABELS[id];
}

export function getActiveEngineId(): LocalAiEngineId {
    return activeEngine?.id ?? "heuristic";
}

export function getActiveEngineLabel(): string {
    if (activeEngine) return activeEngine.getDisplayLabel();
    return ENGINE_LABELS.heuristic;
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

    if (!initPromise) {
        initStartedAt = Date.now();
        initTimedOut = false;
        initPromise = initFirstAvailableEngine()
            .then((engine) => {
                if (engine) activeEngine = engine;
                return engine;
            })
            .finally(() => {
                initPromise = null;
                initStartedAt = null;
            });
    }

    if (!initTimedOut) {
        const elapsed = initStartedAt ? Date.now() - initStartedAt : 0;
        const remaining = Math.max(0, INIT_TIMEOUT_MS - elapsed);
        if (remaining > 0) {
            try {
                await withTimeout(initPromise, remaining);
            } catch (e) {
                initTimedOut = true;
                console.warn("[local-ai] init timed out, proceeding with heuristic", e);
            }
        } else {
            initTimedOut = true;
        }
    }

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

/** Free-text generation via active model; null if no model or generation failed. */
export async function generateWithActiveEngine(prompt: string): Promise<string | null> {
    if (!activeEngine) return null;
    try {
        return await activeEngine.generate(prompt);
    } catch (e) {
        console.warn("[local-ai] model generate failed", e);
        return null;
    }
}

/** Wrap instruction + source text into one generate call. */
export async function rewriteWithActiveEngine(text: string, instruction: string): Promise<string | null> {
    const prompt = `${instruction.trim()}\n\n---\n\n${text.trim()}`;
    return generateWithActiveEngine(prompt);
}

export function resetLocalAiLadderForTests(): void {
    activeEngine = null;
    initPromise = null;
    initStartedAt = null;
    initTimedOut = false;
}
