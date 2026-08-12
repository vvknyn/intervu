import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sendEmail } from "@/lib/email/send";

/**
 * Integration-level companion to email-send-preflight.test.ts: exercises
 * the real exported `sendEmail`, not just the pure decision helper. `tsx
 * --test` never loads `.env.local` (that's a Next-only convenience), so
 * `RESEND_API_KEY` is genuinely unset in this process — the same state a
 * fresh clone with no key configured is in. Never reaches Firestore or the
 * network: if it did, this test would hang/fail outside a real Firebase
 * project, which is exactly what proves the no-op fires before any I/O.
 */
describe("sendEmail — clean no-op without RESEND_API_KEY", () => {
    it("returns sent:false, reason:no-api-key for a suppressible kind", async () => {
        const result = await sendEmail({
            to: "nobody@example.com",
            subject: "test",
            text: "test",
            kind: "digest",
            unsubscribeUrl: "https://intervuhq.com/unsubscribe?token=x",
        });
        assert.deepEqual(result, { sent: false, reason: "no-api-key" });
    });

    it("returns sent:false, reason:no-api-key for a transactional kind too", async () => {
        const result = await sendEmail({
            to: "nobody@example.com",
            subject: "test",
            text: "test",
            kind: "transactional",
        });
        assert.deepEqual(result, { sent: false, reason: "no-api-key" });
    });
});
