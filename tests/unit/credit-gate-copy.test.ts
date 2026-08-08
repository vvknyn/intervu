import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AUTH_REQUIRED_MESSAGE, OUT_OF_CREDITS_MESSAGE } from "@/lib/llm/credit-gate";

// The BYOK entry point (Settings UI to add your own API key) was removed
// 2026-08-08. These hard-block messages used to send users there; they must
// no longer reference a self-service key UI that doesn't exist.
describe("credit-gate hard-block copy (BYOK entry point removed 2026-08-08)", () => {
    it("AUTH_REQUIRED message doesn't point at a self-service API-key UI", () => {
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /api key/i);
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /settings/i);
    });

    it("OUT_OF_CREDITS message doesn't point at a self-service API-key UI", () => {
        assert.doesNotMatch(OUT_OF_CREDITS_MESSAGE, /api key/i);
        assert.doesNotMatch(OUT_OF_CREDITS_MESSAGE, /settings/i);
    });
});
