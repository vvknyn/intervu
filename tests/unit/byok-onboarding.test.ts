import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BYOK_ONBOARDING, BYOK_PROVIDERS } from "@/lib/llm/byok";

describe("BYOK_ONBOARDING", () => {
    it("covers every BYOK provider with non-empty steps and https keysUrl", () => {
        for (const provider of BYOK_PROVIDERS) {
            const onboarding = BYOK_ONBOARDING[provider];
            assert.ok(onboarding, `missing onboarding for ${provider}`);
            assert.ok(onboarding.steps.length > 0, `${provider} has no steps`);
            assert.match(onboarding.keysUrl, /^https:\/\//, `${provider} keysUrl must be https`);
            for (const step of onboarding.steps) {
                assert.ok(step.title.trim().length > 0, `${provider} has an empty step title`);
            }
        }
    });
});
