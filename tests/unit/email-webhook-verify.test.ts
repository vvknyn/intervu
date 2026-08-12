import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifyResendWebhook } from "@/lib/email/webhook-verify";

// Resend signs webhooks per the Standard Webhooks spec (the SDK's
// `resend.webhooks.verify()` — which `verifyResendWebhook` wraps — is
// backed by the `standardwebhooks` package). Signing math replicated here
// from that spec so this test builds real, independently-computed fixtures
// against the REAL verifier, rather than mocking the verifier itself:
//   signature = base64(hmac-sha256(base64-decoded secret, `${id}.${ts}.${payload}`))
// secret carries the conventional "whsec_" prefix; the verifier strips it.
const SECRET = `whsec_${Buffer.from("test-secret-material-for-unit-tests").toString("base64")}`;

function sign(secret: string, id: string, timestamp: string, payload: string): string {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const toSign = `${id}.${timestamp}.${payload}`;
    const digest = crypto.createHmac("sha256", key).update(toSign).digest("base64");
    return `v1,${digest}`;
}

function fixture(payload: string, secret = SECRET) {
    const id = "msg_test123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(secret, id, timestamp, payload);
    return { headers: { id, timestamp, signature }, payload };
}

describe("verifyResendWebhook", () => {
    it("accepts a correctly signed payload and returns the parsed event", () => {
        const payload = JSON.stringify({ type: "email.bounced", created_at: "2026-01-01", data: {} });
        const { headers } = fixture(payload);
        const event = verifyResendWebhook(payload, headers, SECRET);
        assert.ok(event);
        assert.equal(event!.type, "email.bounced");
    });

    it("rejects a payload signed with a different secret", () => {
        const payload = JSON.stringify({ type: "email.complained", created_at: "2026-01-01", data: {} });
        const { headers } = fixture(payload, "whsec_" + Buffer.from("a-different-secret").toString("base64"));
        assert.equal(verifyResendWebhook(payload, headers, SECRET), null);
    });

    it("rejects a payload whose body was tampered with after signing", () => {
        const original = JSON.stringify({ type: "email.bounced", created_at: "2026-01-01", data: {} });
        const { headers } = fixture(original);
        const tampered = JSON.stringify({ type: "email.bounced", created_at: "2099-01-01", data: {} });
        assert.equal(verifyResendWebhook(tampered, headers, SECRET), null);
    });

    it("rejects when the webhook secret is missing — never processes an unverified payload", () => {
        const payload = JSON.stringify({ type: "email.bounced", created_at: "2026-01-01", data: {} });
        const { headers } = fixture(payload);
        assert.equal(verifyResendWebhook(payload, headers, undefined), null);
    });

    it("rejects when signature headers are missing", () => {
        const payload = JSON.stringify({ type: "email.bounced", created_at: "2026-01-01", data: {} });
        assert.equal(
            verifyResendWebhook(payload, { id: null, timestamp: null, signature: null }, SECRET),
            null,
        );
    });
});
