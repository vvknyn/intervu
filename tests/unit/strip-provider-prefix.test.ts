import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripProviderPrefix } from "../../src/lib/llm/strip-provider-prefix";

describe("stripProviderPrefix", () => {
    it("strips a bracketed prefix with no colon", () => {
        assert.equal(stripProviderPrefix("[Groq] rate limited"), "rate limited");
    });

    it("strips a bracketed prefix with a colon", () => {
        assert.equal(stripProviderPrefix("[OpenRouter]: boom"), "boom");
    });

    it("does not eat the first bare word of a message with no bracket", () => {
        assert.equal(
            stripProviderPrefix("AI is temporarily out of credits"),
            "AI is temporarily out of credits",
        );
    });

    it("leaves a plain network-error message untouched", () => {
        assert.equal(stripProviderPrefix("Network error"), "Network error");
    });

    it("leaves a plain status-code message untouched", () => {
        assert.equal(stripProviderPrefix("Request failed: 502"), "Request failed: 502");
    });
});
