export type LocalAiEngineId = "nano" | "webllm" | "transformers" | "heuristic";

export const ENGINE_LABELS: Record<LocalAiEngineId, string> = {
    nano: "On-device · Nano",
    webllm: "On-device · Llama-3.2-3B-Instruct",
    transformers: "On-device · Qwen1.5-0.5B-Chat (WASM)",
    heuristic: "On-device · local rules",
};

/** Raw JSON-ish object from a model before shared normalization. */
export type ModelParseOutput = Record<string, unknown> | null;

export interface LocalAiEngine {
    id: LocalAiEngineId;
    /** Probe availability without downloading weights. */
    isAvailable(): Promise<boolean>;
    /** Load weights / init runtime — call only after user consent. */
    init(): Promise<void>;
    /** Attempt to structure résumé text; null → caller falls back. */
    parseResumeText(text: string): Promise<ModelParseOutput>;
    /** Free-text generation for light rewrite/tailor. Null/throw → caller degrades. */
    generate(prompt: string): Promise<string | null>;
    /** Human-readable label reflecting the actually loaded model. */
    getDisplayLabel(): string;
}
