import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSendPreflight } from "@/lib/email/send";

describe("resolveSendPreflight — no-op-without-key", () => {
    it("skips with no-api-key regardless of everything else being configured", () => {
        const result = resolveSendPreflight({
            hasApiKey: false,
            hasFrom: true,
            hasUnsubscribeUrl: true,
            kind: "digest",
        });
        assert.equal(result, "no-api-key");
    });

    it("no-api-key takes priority over a missing unsubscribe url too", () => {
        const result = resolveSendPreflight({
            hasApiKey: false,
            hasFrom: false,
            hasUnsubscribeUrl: false,
            kind: "digest",
        });
        assert.equal(result, "no-api-key");
    });
});

describe("resolveSendPreflight — non-transactional kinds require an unsubscribe url", () => {
    it("digest without an unsubscribe url is refused even with a key and a from address", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: true,
            hasUnsubscribeUrl: false,
            kind: "digest",
        });
        assert.equal(result, "missing-unsubscribe-url");
    });

    it("waitlist_confirm without an unsubscribe url is refused the same way", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: true,
            hasUnsubscribeUrl: false,
            kind: "waitlist_confirm",
        });
        assert.equal(result, "missing-unsubscribe-url");
    });
});

describe("resolveSendPreflight — transactional kind needs no unsubscribe url", () => {
    it("transactional with no unsubscribe url still proceeds if from address is set", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: true,
            hasUnsubscribeUrl: false,
            kind: "transactional",
        });
        assert.equal(result, null);
    });

    it("transactional still refuses with no from address configured", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: false,
            hasUnsubscribeUrl: false,
            kind: "transactional",
        });
        assert.equal(result, "missing-from-address");
    });
});

describe("resolveSendPreflight — fully configured", () => {
    it("proceeds (null) when key, from, and unsubscribe url are all present", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: true,
            hasUnsubscribeUrl: true,
            kind: "digest",
        });
        assert.equal(result, null);
    });
});
