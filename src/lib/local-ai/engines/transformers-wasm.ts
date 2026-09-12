/**
 * @xenova/transformers text2text — WASM backend (required Mac fallback).
 *
 * Pipeline singleton cached after first init. Dynamic import keeps this out
 * of the server bundle.
 */

import type { LocalAiEngine, ModelParseOutput } from "./types";

const MODEL_ID = "Xenova/LaMini-Flan-T5-248M";

const PARSE_PREFIX = (text: string) =>
    `extract resume json: ${text.slice(0, 3000).replace(/\s+/g, " ")}`;

function tryParseJson(text: string): ModelParseOutput {
    const trimmed = text.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

type Text2TextPipeline = (input: string, options?: { max_new_tokens?: number }) => Promise<{ generated_text: string } | { generated_text: string }[]>;

let pipeline: Text2TextPipeline | null = null;

export const transformersWasmEngine: LocalAiEngine = {
    id: "transformers",

    async isAvailable() {
        // WASM path always available in browser — model download happens on init.
        return typeof window !== "undefined";
    },

    async init() {
        if (pipeline) return;
        const { pipeline: createPipeline, env } = await import("@xenova/transformers");

        // Force WASM backend — do not require WebGPU (no adapter on many Macs).
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends?.onnx?.wasm) {
            env.backends.onnx.wasm.numThreads = 1;
        }

        pipeline = (await createPipeline("text2text-generation", MODEL_ID, {
            progress_callback: () => {},
        })) as Text2TextPipeline;
    },

    async parseResumeText(text: string) {
        if (!pipeline) await this.init();
        const result = await pipeline!(PARSE_PREFIX(text), { max_new_tokens: 512 });
        const generated =
            Array.isArray(result) ? result[0]?.generated_text : result.generated_text;
        return tryParseJson(generated ?? "");
    },
};
