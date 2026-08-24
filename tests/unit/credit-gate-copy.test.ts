import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AUTH_REQUIRED_MESSAGE, OUT_OF_CREDITS_MESSAGE } from "@/lib/llm/credit-gate";

/**
 * Bring-your-own-key was removed from the product on 2026-08-23 — the app funds
 * every AI action. These assertions are the ratchet that keeps the hard-block
 * copy honest: there is no key field in Settings any more, so any message that
 * sends a stuck user there is pointing at a door that isn't there.
 *
 * Both messages are checked, not just the one that carried the upsell, because
 * the failure mode is "someone re-adds a key hint to whichever block they're
 * editing" — not a defect specific to OUT_OF_CREDITS.
 */
describe("credit-gate hard-block copy (no bring-your-own-key remedy)", () => {
    const MESSAGES: [string, string][] = [
        ["AUTH_REQUIRED", AUTH_REQUIRED_MESSAGE],
        ["OUT_OF_CREDITS", OUT_OF_CREDITS_MESSAGE],
    ];

    for (const [name, message] of MESSAGES) {
        it(`${name} message never points at a Settings API key`, () => {
            assert.doesNotMatch(message, /api key/i);
            assert.doesNotMatch(message, /settings/i);
            assert.doesNotMatch(message, /openrouter|groq/i);
        });
    }

    it("AUTH_REQUIRED message still tells an anonymous visitor what to do", () => {
        assert.match(AUTH_REQUIRED_MESSAGE, /sign in/i);
    });

    it("OUT_OF_CREDITS message still says when the allowance comes back", () => {
        assert.match(OUT_OF_CREDITS_MESSAGE, /next month/i);
    });
});
