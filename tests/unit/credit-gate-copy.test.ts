import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AUTH_REQUIRED_MESSAGE, OUT_OF_CREDITS_MESSAGE } from "@/lib/llm/credit-gate";

describe("credit-gate hard-block copy (BYOK in Settings)", () => {
    it("AUTH_REQUIRED message stays sign-in focused (no Settings/API-key upsell for anon users)", () => {
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /api key/i);
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /settings/i);
    });

    it("OUT_OF_CREDITS message offers BYOK in Settings", () => {
        assert.match(OUT_OF_CREDITS_MESSAGE, /settings/i);
        assert.match(OUT_OF_CREDITS_MESSAGE, /openrouter|groq/i);
    });
});
