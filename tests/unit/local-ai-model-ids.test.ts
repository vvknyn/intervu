import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    WEBLLM_MODEL_ID,
} from "../../src/lib/local-ai/engines/webllm";
import {
    WASM_INSTRUCT_MODEL_ID,
    WASM_T5_FALLBACK_MODEL_ID,
} from "../../src/lib/local-ai/engines/transformers-wasm";

const WEBLLM_SRC = join(__dirname, "../../src/lib/local-ai/engines/webllm.ts");
const WASM_SRC = join(__dirname, "../../src/lib/local-ai/engines/transformers-wasm.ts");

describe("local-ai pinned model ids", () => {
    it("WebLLM uses Llama 3.2 3B q4f16", () => {
        assert.equal(WEBLLM_MODEL_ID, "Llama-3.2-3B-Instruct-q4f16_1-MLC");
        const src = readFileSync(WEBLLM_SRC, "utf8");
        assert.match(src, /WEBLLM_MODEL_ID/);
        assert.doesNotMatch(src, /Llama-3\.2-1B-Instruct/);
    });

    it("WASM default instruct model is not LaMini T5", () => {
        assert.notEqual(WASM_INSTRUCT_MODEL_ID, WASM_T5_FALLBACK_MODEL_ID);
        assert.equal(WASM_INSTRUCT_MODEL_ID, "Xenova/Qwen1.5-0.5B-Chat");
        assert.equal(WASM_T5_FALLBACK_MODEL_ID, "Xenova/LaMini-Flan-T5-248M");

        const src = readFileSync(WASM_SRC, "utf8");
        assert.match(src, /text-generation/);
        assert.match(src, /WASM_INSTRUCT_MODEL_ID/);
        assert.match(src, /WASM_T5_FALLBACK_MODEL_ID/);
        assert.match(src, /last-resort|last resort/i);
    });
});
