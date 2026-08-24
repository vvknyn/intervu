import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  SIGNATURE_HEADER_NAMES,
  readWebhookSignatureHeaders,
  verifyResendWebhook,
} from "../../src/lib/email/webhook-verify";

/**
 * Resend disabled our endpoint (Aug 2026) because every delivery 401'd: the
 * route read the Standard Webhooks canonical `webhook-*` names, but Resend —
 * like every Svix-powered sender — emits the legacy `svix-*` spelling. All
 * three headers came back null and the payload was dropped unread.
 */

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;

function sign(payload: string, id: string, timestamp: string): string {
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
}

function delivery(prefix: "webhook" | "svix", payload: string): Headers {
  const id = "msg_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return new Headers({
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: timestamp,
    [`${prefix}-signature`]: sign(payload, id, timestamp),
  });
}

const PAYLOAD = JSON.stringify({
  type: "email.bounced",
  created_at: "2026-08-23T20:00:41.642Z",
  data: { email_id: "e1", to: ["someone@example.invalid"], from: "a@b.invalid", subject: "s" },
});

test("readWebhookSignatureHeaders: reads the legacy svix-* spelling Resend actually sends", () => {
  const h = readWebhookSignatureHeaders(delivery("svix", PAYLOAD));
  for (const name of SIGNATURE_HEADER_NAMES) {
    assert.ok(h[name], `svix-${name} must be read`);
  }
});

test("readWebhookSignatureHeaders: reads the canonical webhook-* spelling too", () => {
  const h = readWebhookSignatureHeaders(delivery("webhook", PAYLOAD));
  for (const name of SIGNATURE_HEADER_NAMES) {
    assert.ok(h[name], `webhook-${name} must be read`);
  }
});

test("readWebhookSignatureHeaders: canonical wins when a sender emits both", () => {
  const headers = new Headers({ "webhook-id": "canonical", "svix-id": "legacy" });
  assert.equal(readWebhookSignatureHeaders(headers).id, "canonical");
});

test("readWebhookSignatureHeaders: all null when neither spelling is present", () => {
  const h = readWebhookSignatureHeaders(new Headers({ "content-type": "application/json" }));
  for (const name of SIGNATURE_HEADER_NAMES) {
    assert.equal(h[name], null, `${name} must be null`);
  }
});

test("verifyResendWebhook: a genuine signed delivery verifies under EITHER spelling", () => {
  for (const prefix of ["svix", "webhook"] as const) {
    const event = verifyResendWebhook(PAYLOAD, readWebhookSignatureHeaders(delivery(prefix, PAYLOAD)), SECRET);
    assert.ok(event, `a correctly signed ${prefix}-* delivery must verify`);
    assert.equal(event.type, "email.bounced");
  }
});

test("verifyResendWebhook: a tampered payload still fails under either spelling", () => {
  for (const prefix of ["svix", "webhook"] as const) {
    const headers = readWebhookSignatureHeaders(delivery(prefix, PAYLOAD));
    assert.equal(verifyResendWebhook(`${PAYLOAD} tampered`, headers, SECRET), null);
  }
});
