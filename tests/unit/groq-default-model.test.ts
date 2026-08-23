import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AVAILABLE_MODELS, GROQ_DEFAULT_MODEL } from "@/lib/llm/models";

describe("Groq default model (post-Aug-2026 deprecation)", () => {
    it("GROQ_DEFAULT_MODEL is openai/gpt-oss-20b, not llama-3.3-70b-versatile", () => {
        assert.equal(GROQ_DEFAULT_MODEL, "openai/gpt-oss-20b");
        assert.notEqual(GROQ_DEFAULT_MODEL, "llama-3.3-70b-versatile");
    });

    it("AVAILABLE_MODELS.groq first entry matches GROQ_DEFAULT_MODEL (setPreferredProvider writes this)", () => {
        assert.equal(AVAILABLE_MODELS.groq[0].id, GROQ_DEFAULT_MODEL);
    });

    it("deprecated llama-3.3-70b-versatile is absent from AVAILABLE_MODELS.groq", () => {
        const ids = AVAILABLE_MODELS.groq.map((m) => m.id);
        assert.ok(!ids.includes("llama-3.3-70b-versatile" as any), "deprecated model must not appear in list");
    });

    it("deprecated llama-3.1-8b-instant is absent from AVAILABLE_MODELS.groq", () => {
        const ids = AVAILABLE_MODELS.groq.map((m) => m.id);
        assert.ok(!ids.includes("llama-3.1-8b-instant" as any), "deprecated model must not appear in list");
    });
});
