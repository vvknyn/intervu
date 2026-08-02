import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sessionCreditsLabel, type PrepEntitlement } from "../../src/components/prep/PrepModeSelection";

function entitlement(overrides: Partial<PrepEntitlement> = {}): PrepEntitlement {
    return { isAdmin: false, isBYOK: false, credits: 14, monthlyFree: 0, ...overrides };
}

describe("sessionCreditsLabel", () => {
    it("is null when there is no entitlement yet (not fetched / not signed in)", () => {
        assert.equal(sessionCreditsLabel(null), null);
        assert.equal(sessionCreditsLabel(undefined), null);
    });

    it("is null for an admin account — 'N left' would misstate an unlimited account", () => {
        assert.equal(sessionCreditsLabel(entitlement({ isAdmin: true })), null);
    });

    it("is null for a BYOK account — credits don't gate a bring-your-own-key account", () => {
        assert.equal(sessionCreditsLabel(entitlement({ isBYOK: true })), null);
    });

    it("renders the real remaining count for a normal credits-metered account", () => {
        assert.equal(sessionCreditsLabel(entitlement({ credits: 14 })), "credits: 14 left");
        assert.equal(sessionCreditsLabel(entitlement({ credits: 0 })), "credits: 0 left");
    });
});
