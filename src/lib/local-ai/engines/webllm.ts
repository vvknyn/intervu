/**
 * WebLLM via CDN dynamic import — only when WebGPU adapter exists.
 *
 * CDN origin: https://esm.run (see next.config / CSP connect-src https:).
 * Not bundled as npm dep to keep install lean; WASM transformers is required path.
 */

import type { LocalAiEngine, ModelParseOutput } from "./types";

const WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm@0.2.79";

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

let engine: { chat: { completions: { create: (opts: { messages: { role: string; content: string }[]; temperature?: number }) => Promise<{ choices: { message: { content: string } }[] }> } } } | null = null;

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

    async isAvailable() {
        return hasWebGpuAdapter();
    },

    async init() {
        if (!(await hasWebGpuAdapter())) {
            throw new Error("WebGPU adapter unavailable");
        }
        // Dynamic CDN import — not in server bundle
        const mod = (await import(/* webpackIgnore: true */ WEBLLM_CDN)) as {
            CreateMLCEngine: (model: string, opts?: { initProgressCallback?: (p: { progress: number }) => void }) => Promise<typeof engine>;
        };
        engine = await mod.CreateMLCEngine("Llama-3.2-1B-Instruct-q4f16_1-MLC", {
            initProgressCallback: () => {},
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

    async generate(prompt: string) {
        if (!engine) await this.init();
        const response = await engine!.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
        });
        return response.choices[0]?.message?.content ?? null;
    },
};
