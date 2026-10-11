/**
 * WebLLM via CDN dynamic import — only when WebGPU adapter exists.
 *
 * CDN origin: https://esm.run (see next.config / CSP connect-src https:).
 * Not bundled as npm dep to keep install lean; WASM transformers is required path.
 */

import type { ModelLoadReport } from "../model-load";
import type { GenerateOptions, LocalAiEngine, ModelParseOutput } from "./types";

const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm@0.2.79";

/** Strongest practical everyday WebGPU model in the 0.2.79 catalog (~2.3GB VRAM). */
export const WEBLLM_MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

/**
 * Sum of the Hugging Face repo file sizes for mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC
 * (params_shard_0..57 + tokenizer.json), measured 2026-09-28 via the HF model API.
 */
export const WEBLLM_DOWNLOAD_BYTES = 1_816_811_105;

export function getWebllmDisplayLabel(): string {
    return "On-device · Llama-3.2-3B-Instruct";
}

const PARSE_PROMPT = (text: string) => `Extract resume as JSON. Fields: profile, experience, competencies, education, generatedSummary.

"""
${text.slice(0, 6000)}
"""

JSON only:`;

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

type ChatOptions = {
    messages: { role: string; content: string }[];
    temperature?: number;
    max_tokens?: number;
    /** JSON mode: the reply is grammar-constrained to `schema` (a JSON string). */
    response_format?: { type: "json_object"; schema?: string };
};

let engine: { chat: { completions: { create: (opts: ChatOptions) => Promise<{ choices: { message: { content: string } }[] }> } } } | null = null;

type WebllmModule = {
    CreateMLCEngine: (
        model: string,
        opts?: { initProgressCallback?: (p: { progress: number }) => void },
    ) => Promise<typeof engine>;
    hasModelInCache?: (model: string) => Promise<boolean>;
};

// Dynamic CDN import — not in server bundle
async function loadWebllm(): Promise<WebllmModule> {
    return (await import(/* webpackIgnore: true */ WEBLLM_CDN)) as WebllmModule;
}

type NavigatorWithGpu = Navigator & {
    gpu?: { requestAdapter(): Promise<{ readonly?: unknown } | null> };
};

export async function hasWebGpuAdapter(): Promise<boolean> {
    const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithGpu) : null;
    if (!nav?.gpu?.requestAdapter) return false;
    try {
        const adapter = await nav.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

export const webllmEngine: LocalAiEngine = {
    id: "webllm",
    downloadBytes: WEBLLM_DOWNLOAD_BYTES,

    async isCached() {
        try {
            return (await (await loadWebllm()).hasModelInCache?.(WEBLLM_MODEL_ID)) ?? false;
        } catch {
            return false;
        }
    },

    async isAvailable() {
        return hasWebGpuAdapter();
    },

    async init(report?: ModelLoadReport) {
        if (!(await hasWebGpuAdapter())) {
            throw new Error("WebGPU adapter unavailable");
        }
        const mod = await loadWebllm();
        engine = await mod.CreateMLCEngine(WEBLLM_MODEL_ID, {
            initProgressCallback: (p) => report?.({ kind: "fraction", fraction: p.progress }),
        });
    },

    async parseResumeText(text: string) {
        if (!engine) await this.init();
        const response = await engine!.chat.completions.create({
            messages: [{ role: "user", content: PARSE_PROMPT(text) }],
            temperature: 0.1,
        });
        const content = response.choices[0]?.message?.content ?? "";
        return tryParseJson(content);
    },

    async generate(prompt: string, options?: GenerateOptions) {
        if (!engine) await this.init();
        const chat: ChatOptions = {
            messages: [
                ...(options?.examples ?? []).flatMap((e) => [
                    { role: "user", content: e.prompt },
                    { role: "assistant", content: e.reply },
                ]),
                { role: "user", content: prompt },
            ],
            temperature: options?.temperature ?? 0.3,
            ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        };
        if (!options?.schema) return (await engine!.chat.completions.create(chat)).choices[0]?.message?.content ?? null;
        try {
            const constrained = { ...chat, response_format: { type: "json_object" as const, schema: JSON.stringify(options.schema) } };
            return (await engine!.chat.completions.create(constrained)).choices[0]?.message?.content ?? null;
        } catch (e) {
            // A schema this WebLLM build can't compile: ask again unconstrained.
            console.warn("[local-ai] webllm JSON mode failed, retrying without it", e);
            return (await engine!.chat.completions.create(chat)).choices[0]?.message?.content ?? null;
        }
    },

    getDisplayLabel() {
        return getWebllmDisplayLabel();
    },
};
