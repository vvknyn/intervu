import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validate, saveProviderApiKeySchema, validateProviderKeySchema, setPreferredProviderSchema } from "@/lib/validation";
import { providerKeyPresence } from "@/lib/llm/byok";

describe("BYOK validation schemas", () => {
    it("validateProviderKeySchema accepts known providers with a non-empty key", () => {
        const parsed = validate(validateProviderKeySchema, {
            provider: "openrouter",
            key: " sk-or-test ",
        });
        assert.equal(parsed.ok, true);
        if (parsed.ok) {
            assert.equal(parsed.data.provider, "openrouter");
            assert.equal(parsed.data.key, "sk-or-test");
        }
    });

    it("validateProviderKeySchema rejects empty keys", () => {
        const parsed = validate(validateProviderKeySchema, { provider: "groq", key: "   " });
        assert.equal(parsed.ok, false);
    });

    it("validateProviderKeySchema rejects unknown providers", () => {
        const parsed = validate(validateProviderKeySchema, { provider: "openai", key: "sk-test" });
        assert.equal(parsed.ok, false);
    });

    it("saveProviderApiKeySchema allows empty key to clear", () => {
        const parsed = validate(saveProviderApiKeySchema, { provider: "groq", key: "" });
        assert.equal(parsed.ok, true);
    });

    it("saveProviderApiKeySchema rejects oversize keys", () => {
        const parsed = validate(saveProviderApiKeySchema, { provider: "openrouter", key: "x".repeat(513) });
        assert.equal(parsed.ok, false);
    });

    it("setPreferredProviderSchema accepts groq", () => {
        const parsed = validate(setPreferredProviderSchema, { provider: "groq" });
        assert.equal(parsed.ok, true);
        if (parsed.ok) assert.equal(parsed.data.provider, "groq");
    });
});

describe("providerKeyPresence", () => {
    it("returns false for both providers when unset", () => {
        assert.deepEqual(providerKeyPresence(undefined), { openrouter: false, groq: false });
    });

    it("detects encrypted keys without decrypting", () => {
        const stored = JSON.stringify({
            openrouter: "enc:abc123",
            groq: "",
        });
        assert.deepEqual(providerKeyPresence(stored), { openrouter: true, groq: false });
    });

    it("ignores legacy non-JSON values", () => {
        assert.deepEqual(providerKeyPresence("sk-legacy-single-key"), { openrouter: false, groq: false });
    });
});
