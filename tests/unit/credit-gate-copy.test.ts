import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AUTH_REQUIRED_MESSAGE } from "@/lib/llm/credit-gate";

/**
 * Bring-your-own-key was removed from the product on 2026-08-23, and credits
 * were removed 2026-08-27 (everything free — see credit-gate.ts's doc
 * comment). This is the ratchet that keeps the one remaining hard-block
 * message honest: there is no key field in Settings and nothing to spend, so
 * any message that sends a stuck user to a Settings API key or a credits
 * balance is pointing at a door that isn't there.
 */
describe("credit-gate hard-block copy (no bring-your-own-key remedy)", () => {
    it("AUTH_REQUIRED message never points at a Settings API key", () => {
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /api key/i);
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /settings/i);
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /openrouter|groq/i);
    });

    it("AUTH_REQUIRED message still tells an anonymous visitor what to do", () => {
        assert.match(AUTH_REQUIRED_MESSAGE, /sign in/i);
    });
});
