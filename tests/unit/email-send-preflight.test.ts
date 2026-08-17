import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSendPreflight } from "@/lib/email/send";

describe("resolveSendPreflight — no-op-without-key", () => {
    it("skips with no-api-key regardless of everything else being configured", () => {
        const result = resolveSendPreflight({
            hasApiKey: false,
            to: "person@example.com",
            hasFrom: true,
            hasUnsubscribeUrl: true,
            kind: "digest",
        });
        assert.equal(result, "no-api-key");
    });

    it("no-api-key takes priority over a missing unsubscribe url too", () => {
        const result = resolveSendPreflight({
            hasApiKey: false,
            to: "person@example.com",
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
            to: "person@example.com",
            hasFrom: true,
            hasUnsubscribeUrl: false,
            kind: "digest",
        });
        assert.equal(result, "missing-unsubscribe-url");
    });

    it("waitlist_confirm without an unsubscribe url is refused the same way", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            to: "person@example.com",
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
            to: "person@example.com",
            hasFrom: true,
            hasUnsubscribeUrl: false,
            kind: "transactional",
        });
        assert.equal(result, null);
    });

    it("transactional still refuses with no from address configured", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            to: "person@example.com",
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
            to: "person@example.com",
            hasFrom: true,
            hasUnsubscribeUrl: true,
            kind: "digest",
        });
        assert.equal(result, null);
    });
});

describe("resolveSendPreflight — a minted login address has no mailbox", () => {
    /**
     * Password signup synthesizes `<username>@intervu.cc` with nothing
     * behind it, so every send there is a guaranteed hard bounce — and
     * bounce rate is the largest single input to a sending domain's
     * reputation, which every other kind then inherits.
     *
     * This lives in the ONE chokepoint every send passes through, not in
     * each sender. The welcome email guarded it independently and the
     * digest — the recurring one, so the far more damaging one — did not; a
     * dry run on 2026-08-17 found a minted address at the top of the
     * eligible set. Checking here means a new email kind cannot reintroduce
     * the gap by forgetting.
     */
    it("refuses a minted login address for every kind, however well configured", () => {
        for (const kind of ["digest", "welcome", "waitlist_confirm", "transactional"] as const) {
            const result = resolveSendPreflight({
                hasApiKey: true,
                hasFrom: true,
                hasUnsubscribeUrl: true,
                to: "vvk@intervu.cc",
                kind,
            });
            assert.equal(result, "no-mailbox", kind);
        }
    });

    // Reported as a fact about the recipient, not as a misconfiguration —
    // otherwise it sends someone off to fix a from-address that is fine.
    it("says no-mailbox rather than blaming the configuration", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: false,
            hasUnsubscribeUrl: false,
            to: "vvk@intervu.cc",
            kind: "digest",
        });
        assert.equal(result, "no-mailbox");
    });

    // A missing key still wins: no key means no client is ever constructed,
    // which is the cheapest branch and the established no-op posture.
    it("still reports no-api-key first", () => {
        const result = resolveSendPreflight({
            hasApiKey: false,
            hasFrom: true,
            hasUnsubscribeUrl: true,
            to: "vvk@intervu.cc",
            kind: "digest",
        });
        assert.equal(result, "no-api-key");
    });

    it("lets a real address through", () => {
        const result = resolveSendPreflight({
            hasApiKey: true,
            hasFrom: true,
            hasUnsubscribeUrl: true,
            to: "person@gmail.com",
            kind: "digest",
        });
        assert.equal(result, null);
    });
});
