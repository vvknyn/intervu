import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

// Test-only key material — `getEncryptionKey()` (lib/encryption.ts) reads
// `process.env.ENCRYPTION_KEY` fresh on every call (no module-level
// caching), so toggling it per-test here is safe and doesn't bleed across
// test files the way a cached singleton would.
const TEST_KEY = "a".repeat(64); // 32 bytes hex
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("unsubscribe token sign/verify", () => {
    it("round-trips email + kind", () => {
        const token = signUnsubscribeToken("Person@Example.com", "digest");
        assert.ok(token);
        const payload = verifyUnsubscribeToken(token!);
        assert.deepEqual(payload, { email: "person@example.com", kind: "digest" });
    });

    it("round-trips the 'all' scope", () => {
        const token = signUnsubscribeToken("person@example.com", "all");
        const payload = verifyUnsubscribeToken(token!);
        assert.deepEqual(payload, { email: "person@example.com", kind: "all" });
    });

    it("tamper → reject: flipping a payload character invalidates the signature", () => {
        const token = signUnsubscribeToken("person@example.com", "digest")!;
        const [encoded, signature] = token.split(".");
        const tamperedEncoded = encoded.slice(0, -1) + (encoded.at(-1) === "A" ? "B" : "A");
        assert.equal(verifyUnsubscribeToken(`${tamperedEncoded}.${signature}`), null);
    });

    it("tamper → reject: flipping a signature character invalidates it", () => {
        const token = signUnsubscribeToken("person@example.com", "digest")!;
        const [encoded, signature] = token.split(".");
        const tamperedSig = signature.slice(0, -1) + (signature.at(-1) === "A" ? "B" : "A");
        assert.equal(verifyUnsubscribeToken(`${encoded}.${tamperedSig}`), null);
    });

    it("wrong kind → reject: a token signed for one kind fails verify() pinned to a different kind", () => {
        const token = signUnsubscribeToken("person@example.com", "digest")!;
        assert.equal(verifyUnsubscribeToken(token, "waitlist_confirm"), null);
        // ...but still verifies against its actual kind.
        assert.deepEqual(verifyUnsubscribeToken(token, "digest"), {
            email: "person@example.com",
            kind: "digest",
        });
    });

    it("malformed tokens (no separator, empty string) reject cleanly, never throw", () => {
        assert.equal(verifyUnsubscribeToken(""), null);
        assert.equal(verifyUnsubscribeToken("not-a-real-token"), null);
        assert.equal(verifyUnsubscribeToken("onlyonepart"), null);
    });

    it("no ENCRYPTION_KEY: sign and verify both no-op to null, never throw", () => {
        delete process.env.ENCRYPTION_KEY;
        assert.equal(signUnsubscribeToken("person@example.com", "digest"), null);
        // A token minted under a real key still fails closed with no key to check it against.
        process.env.ENCRYPTION_KEY = TEST_KEY;
        const token = signUnsubscribeToken("person@example.com", "digest")!;
        delete process.env.ENCRYPTION_KEY;
        assert.equal(verifyUnsubscribeToken(token), null);
    });
});
