import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    AUTH_REQUIRED_MESSAGE,
    BYOK_REQUIRED,
    BYOK_REQUIRED_MESSAGE,
    BYOK_SETTINGS_HINT,
    OUT_OF_CREDITS_MESSAGE,
    resolveSharedKeyAccess,
} from "@/lib/llm/credit-gate";
import { classifySentinel, sentinelMessage } from "@/lib/llm/sentinels";

describe("resolveSharedKeyAccess (free tier BYOK-only)", () => {
    it("anonymous callers cannot use the shared key", () => {
        assert.equal(resolveSharedKeyAccess({ hasUser: false, isAdmin: false }), "auth_required");
    });

    it("admins may use the shared key", () => {
        assert.equal(resolveSharedKeyAccess({ hasUser: true, isAdmin: true }), "allow");
    });

    it("signed-in non-admin users must bring their own key", () => {
        assert.equal(resolveSharedKeyAccess({ hasUser: true, isAdmin: false }), "byok_required");
    });
});

describe("BYOK_REQUIRED sentinel copy", () => {
    it("uses the Settings onboarding hint verbatim", () => {
        assert.equal(BYOK_REQUIRED_MESSAGE, BYOK_SETTINGS_HINT);
    });

    it("classifies and strips the BYOK_REQUIRED prefix for UI", () => {
        const raw = `${BYOK_REQUIRED}: ${BYOK_REQUIRED_MESSAGE}`;
        assert.equal(classifySentinel(raw), "byok");
        assert.equal(sentinelMessage(raw), BYOK_REQUIRED_MESSAGE);
    });

    it("AUTH_REQUIRED stays sign-in focused (no Settings upsell for anon)", () => {
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /api key/i);
        assert.doesNotMatch(AUTH_REQUIRED_MESSAGE, /settings/i);
    });

    it("OUT_OF_CREDITS still offers BYOK in Settings", () => {
        assert.match(OUT_OF_CREDITS_MESSAGE, /settings/i);
        assert.match(OUT_OF_CREDITS_MESSAGE, /openrouter|groq/i);
    });
});
