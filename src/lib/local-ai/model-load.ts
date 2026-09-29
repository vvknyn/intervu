/**
 * Model-load progress — pure. Engines report `ModelLoadEvent`s from their real
 * download callbacks; `reduceModelLoad` folds them into one state and
 * `modelLoadView` derives what the UI may say. Every number shown comes from a
 * reported byte count or fraction — nothing is simulated.
 */

import type { LocalAiEngineId } from "./engines/types";

export type ModelLoadEvent =
    /** The engine is about to load. `cached` = weights already on this device. */
    | { kind: "begin"; engine: LocalAiEngineId; cached: boolean; expectedBytes: number | null }
    /** Per-file byte progress (transformers.js). */
    | { kind: "file"; file: string; loaded: number }
    /** Whole-model fraction 0..1 (WebLLM, Chrome Nano). */
    | { kind: "fraction"; fraction: number }
    | { kind: "end"; ok: boolean };

export type ModelLoadReport = (event: ModelLoadEvent) => void;

export type ModelLoadState =
    | { phase: "idle" }
    | {
          phase: "loading";
          engine: LocalAiEngineId;
          cached: boolean;
          startedAt: number;
          expectedBytes: number | null;
          files: Record<string, number>;
          fraction: number | null;
          /** First moment progress moved off zero — the ETA rate is measured from here. */
          firstMoveAt: number | null;
          firstMoveFraction: number;
      }
    | { phase: "ready" }
    | { phase: "failed" };

export const IDLE_MODEL_LOAD: ModelLoadState = { phase: "idle" };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function sumBytes(files: Record<string, number>): number {
    return Object.values(files).reduce((a, b) => a + b, 0);
}

export function reduceModelLoad(state: ModelLoadState, event: ModelLoadEvent, now: number): ModelLoadState {
    if (event.kind === "begin") {
        return {
            phase: "loading",
            engine: event.engine,
            cached: event.cached,
            startedAt: now,
            expectedBytes: event.expectedBytes,
            files: {},
            fraction: null,
            firstMoveAt: null,
            firstMoveFraction: 0,
        };
    }
    if (event.kind === "end") return event.ok ? { phase: "ready" } : { phase: "failed" };
    if (state.phase !== "loading") return state;

    const files = event.kind === "file" ? { ...state.files, [event.file]: event.loaded } : state.files;
    let fraction = state.fraction;
    if (event.kind === "fraction") fraction = clamp01(event.fraction);
    else if (state.expectedBytes) fraction = clamp01(sumBytes(files) / state.expectedBytes);

    const moved = fraction !== null && fraction > 0 && state.firstMoveAt === null;
    return {
        ...state,
        files,
        fraction,
        firstMoveAt: moved ? now : state.firstMoveAt,
        firstMoveFraction: moved ? fraction! : state.firstMoveFraction,
    };
}

/** ETA is only offered after this long of measured movement — earlier rates are noise. */
export const ETA_MIN_MEASURE_MS = 2_000;

export interface ModelLoadView {
    cached: boolean;
    /** Null → indeterminate bar. */
    fraction: number | null;
    /** Bytes received so far — null when the engine reports only a fraction. */
    loadedBytes: number | null;
    /** Total download size — null when unknown. */
    totalBytes: number | null;
    /** Seconds left at the measured average rate; null until measurable, and never for a cached load. */
    etaSeconds: number | null;
}

export function modelLoadView(state: ModelLoadState, now: number): ModelLoadView | null {
    if (state.phase !== "loading") return null;
    const loaded = sumBytes(state.files);
    const measuredMs = state.firstMoveAt === null ? 0 : now - state.firstMoveAt;
    const gained = state.fraction === null ? 0 : state.fraction - state.firstMoveFraction;
    const etaSeconds =
        !state.cached && state.fraction !== null && measuredMs >= ETA_MIN_MEASURE_MS && gained > 0
            ? ((1 - state.fraction) / (gained / measuredMs)) / 1000
            : null;
    return {
        cached: state.cached,
        fraction: state.fraction,
        loadedBytes: Object.keys(state.files).length > 0 ? loaded : null,
        totalBytes: state.expectedBytes,
        etaSeconds,
    };
}

/** Decimal MB/GB, matching how Hugging Face and OS download dialogs report size. */
export function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${Math.round(bytes / 1e6)} MB`;
}

export function formatEta(seconds: number): string {
    if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s left`;
    return `about ${Math.round(seconds / 60)} min left`;
}

/** The size sentence for a download in flight, e.g. "212 MB of 494 MB (43%) · about 40 s left". */
export function describeModelLoad(view: ModelLoadView): string {
    const parts: string[] = [];
    if (view.loadedBytes !== null && view.totalBytes !== null) {
        const percent = view.fraction !== null ? ` (${Math.round(view.fraction * 100)}%)` : "";
        parts.push(`${formatBytes(Math.min(view.loadedBytes, view.totalBytes))} of ${formatBytes(view.totalBytes)}${percent}`);
    } else if (view.loadedBytes !== null) {
        parts.push(`${formatBytes(view.loadedBytes)} downloaded (total size unknown)`);
    } else if (view.fraction !== null) {
        const percent = `${Math.round(view.fraction * 100)}%`;
        parts.push(view.totalBytes !== null ? `${percent} of ${formatBytes(view.totalBytes)}` : percent);
    } else if (view.totalBytes !== null) {
        parts.push(`${formatBytes(view.totalBytes)} download`);
    }
    if (view.etaSeconds !== null) parts.push(formatEta(view.etaSeconds));
    return parts.join(" · ");
}

/**
 * Consent copy for what enabling the model will download: the best available
 * engine's measured size, or why there is none. Empty when no model engine is
 * available (rules only — nothing downloads).
 */
export function downloadSizeLine(best: { id: LocalAiEngineId; bytes: number | null }): string {
    if (best.id === "heuristic") return "";
    const size = best.bytes !== null ? `The model is about ${formatBytes(best.bytes)}.` : "Chrome manages this model's download, so its size isn't shown here.";
    return `${size} It's a one-time download, cached for next time.`;
}
