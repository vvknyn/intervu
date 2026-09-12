/**
 * @xenova/transformers text-generation — WASM backend (required Mac fallback).
 *
 * Pipeline singleton cached after first init. Dynamic import keeps this out
 * of the server bundle.
 */

import type { LocalAiEngine, ModelParseOutput } from "./types";

/** Preferred instruct model for Xenova transformers.js v2 (text-generation). */
export const WASM_INSTRUCT_MODEL_ID = "Xenova/Qwen1.5-0.5B-Chat";

/** Last-resort fallback when the instruct model fails to init (OOM). */
export const WASM_T5_FALLBACK_MODEL_ID = "Xenova/LaMini-Flan-T5-248M";

type TextGenPipeline = (
    input: string,
    options?: { max_new_tokens?: number; do_sample?: boolean; return_full_text?: boolean },
) => Promise<{ generated_text: string } | { generated_text: string }[]>;

type Text2TextPipeline = (
    input: string,
    options?: { max_new_tokens?: number },
) => Promise<{ generated_text: string } | { generated_text: string }[]>;

type ChatTokenizer = {
    apply_chat_template?: (
        messages: { role: string; content: string }[],
        opts: { tokenize: boolean; add_generation_prompt: boolean },
    ) => string;
};

type LoadedWasmModel =
    | { kind: "instruct"; pipeline: TextGenPipeline; tokenizer?: ChatTokenizer }
    | { kind: "t5-fallback"; pipeline: Text2TextPipeline };

let loaded: LoadedWasmModel | null = null;

function shortModelName(modelId: string): string {
    return modelId.replace(/^Xenova\//, "");
}

export function getWasmDisplayLabel(): string {
    if (!loaded) {
        return `On-device · ${shortModelName(WASM_INSTRUCT_MODEL_ID)} (WASM)`;
    }
    if (loaded.kind === "t5-fallback") {
        return "On-device · Flan-T5 248M (WASM, last resort)";
    }
    return `On-device · ${shortModelName(WASM_INSTRUCT_MODEL_ID)} (WASM)`;
}

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

function formatQwenChat(userContent: string, tokenizer?: ChatTokenizer): string {
    const messages = [{ role: "user", content: userContent }];
    if (tokenizer?.apply_chat_template) {
        return tokenizer.apply_chat_template(messages, {
            tokenize: false,
            add_generation_prompt: true,
        });
    }
    return `<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n`;
}

function extractGeneratedText(
    result: { generated_text: string } | { generated_text: string }[],
): string {
    if (Array.isArray(result)) return result[0]?.generated_text ?? "";
    return result.generated_text ?? "";
}

async function initInstructPipeline(): Promise<LoadedWasmModel> {
    const { pipeline: createPipeline, env } = await import("@xenova/transformers");

    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
    }

    const genPipeline = (await createPipeline("text-generation", WASM_INSTRUCT_MODEL_ID, {
        progress_callback: () => {},
    })) as TextGenPipeline & { tokenizer?: ChatTokenizer };

    return {
        kind: "instruct",
        pipeline: genPipeline,
        tokenizer: genPipeline.tokenizer,
    };
}

async function initT5FallbackPipeline(): Promise<LoadedWasmModel> {
    const { pipeline: createPipeline, env } = await import("@xenova/transformers");

    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = 1;
    }

    const t5Pipeline = (await createPipeline("text2text-generation", WASM_T5_FALLBACK_MODEL_ID, {
        progress_callback: () => {},
    })) as Text2TextPipeline;

    return { kind: "t5-fallback", pipeline: t5Pipeline };
}

const PARSE_INSTRUCTION = (text: string) =>
    `Extract resume as JSON. Fields: profile, experience, competencies, education, generatedSummary. Resume text:\n${text.slice(0, 3000)}`;

const T5_PARSE_PREFIX = (text: string) =>
    `extract resume json: ${text.slice(0, 3000).replace(/\s+/g, " ")}`;

export const transformersWasmEngine: LocalAiEngine = {
    id: "transformers",

    async isAvailable() {
        return typeof window !== "undefined";
    },

    async init() {
        if (loaded) return;
        try {
            loaded = await initInstructPipeline();
        } catch (e) {
            console.warn(
                `[local-ai] ${WASM_INSTRUCT_MODEL_ID} init failed — falling back to ${WASM_T5_FALLBACK_MODEL_ID}`,
                e,
            );
            loaded = await initT5FallbackPipeline();
        }
    },

    async parseResumeText(text: string) {
        if (!loaded) await this.init();
        if (loaded!.kind === "instruct") {
            const prompt = formatQwenChat(PARSE_INSTRUCTION(text), loaded!.tokenizer);
            const result = await loaded!.pipeline(prompt, {
                max_new_tokens: 512,
                do_sample: false,
                return_full_text: false,
            });
            return tryParseJson(extractGeneratedText(result));
        }
        const result = await loaded!.pipeline(T5_PARSE_PREFIX(text), { max_new_tokens: 512 });
        return tryParseJson(extractGeneratedText(result));
    },

    async generate(prompt: string) {
        if (!loaded) await this.init();
        const trimmed = prompt.slice(0, 3000);
        if (loaded!.kind === "instruct") {
            const chatPrompt = formatQwenChat(trimmed, loaded!.tokenizer);
            const result = await loaded!.pipeline(chatPrompt, {
                max_new_tokens: 320,
                do_sample: false,
                return_full_text: false,
            });
            return extractGeneratedText(result) || null;
        }
        const result = await loaded!.pipeline(trimmed.replace(/\s+/g, " "), { max_new_tokens: 320 });
        return extractGeneratedText(result) || null;
    },

    getDisplayLabel() {
        return getWasmDisplayLabel();
    },
};

/** Reset loaded model state — tests only. */
export function resetWasmEngineForTests(): void {
    loaded = null;
}
