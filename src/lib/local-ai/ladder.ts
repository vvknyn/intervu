/**
 * On-device engine ladder — init only after user consent, enforced in
 * `initLocalAiLadder`: every model load in the app goes through it.
 *
 * Order: Nano → WebLLM (WebGPU) → Transformers WASM → heuristic rules.
 */

import { readLocalAiConsent } from "./consent";
import { IDLE_MODEL_LOAD, reduceModelLoad, type ModelLoadEvent, type ModelLoadState } from "./model-load";
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

// Load progress lives here, not in a component, so any UI sees a load that
// started elsewhere (e.g. the landing pre-warm).
let modelLoad: ModelLoadState = IDLE_MODEL_LOAD;
const modelLoadListeners = new Set<() => void>();

function reportModelLoad(event: ModelLoadEvent): void {
    modelLoad = reduceModelLoad(modelLoad, event, Date.now());
    modelLoadListeners.forEach((listener) => listener());
}

export function getModelLoadState(): ModelLoadState {
    return modelLoad;
}

export function subscribeModelLoad(listener: () => void): () => void {
    modelLoadListeners.add(listener);
    return () => {
        modelLoadListeners.delete(listener);
    };
}

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
            reportModelLoad({
                kind: "begin",
                engine: engine.id,
                cached: await engine.isCached(),
                expectedBytes: engine.downloadBytes,
            });
            await engine.init(reportModelLoad);
            reportModelLoad({ kind: "end", ok: true });
            return engine;
        } catch (e) {
            console.warn(`[local-ai] ${engine.id} init failed`, e);
        }
    }
    reportModelLoad({ kind: "end", ok: false });
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

async function findAvailableEngine(): Promise<LocalAiEngine | null> {
    for (const engine of LADDER) {
        if (await engine.isAvailable()) return engine;
    }
    return null;
}

/** Probe ladder without downloading — returns first engine that reports available. */
export async function probeBestEngine(): Promise<LocalAiEngineId> {
    return (await findAvailableEngine())?.id ?? "heuristic";
}

/** What the best available engine would download on first use — for consent copy. Touches no network. */
export async function probeBestDownload(): Promise<{ id: LocalAiEngineId; bytes: number | null }> {
    const engine = await findAvailableEngine();
    return { id: engine?.id ?? "heuristic", bytes: engine?.downloadBytes ?? null };
}

/**
 * Init the first available engine in ladder order. Caches singleton.
 * Falls through to heuristic (no throw) if all model inits fail.
 *
 * `waitMs` bounds how long THIS call waits (the init itself keeps going in the
 * background); `Infinity` waits for the model however long the download takes.
 */
export async function initLocalAiLadder({ waitMs = INIT_TIMEOUT_MS }: { waitMs?: number } = {}): Promise<LocalAiEngineId> {
    // The one consent gate: without it no engine is probed, inited or downloaded, whoever calls.
    if (!readLocalAiConsent()) return "heuristic";
    if (activeEngine) return activeEngine.id;

    if (!initPromise) {
        initStartedAt = Date.now();
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

    const remaining = waitMs - (initStartedAt ? Date.now() - initStartedAt : 0);
    if (remaining > 0) {
        try {
            // setTimeout(Infinity) fires at once, so an unbounded wait skips the timer.
            await (Number.isFinite(remaining) ? withTimeout(initPromise, remaining) : initPromise);
        } catch (e) {
            console.warn("[local-ai] init timed out, proceeding with heuristic", e);
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
    modelLoad = IDLE_MODEL_LOAD;
}
