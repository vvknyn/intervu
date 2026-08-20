import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { verifyFollowEmailContent, sendVerifyFollowEmail } from "@/lib/email/verify-follow";
import { resolveSendPreflight } from "@/lib/email/send";

const VERIFY_URL = "https://intervuhq.com/api/follow-email/verify?token=abc123";

describe("verifyFollowEmailContent", () => {
  it("mentions the company name in the subject and body", () => {
    const { subject, text } = verifyFollowEmailContent({ companyName: "Acme Corp", verifyUrl: VERIFY_URL });
    assert.match(subject, /Acme Corp/);
    assert.match(text, /Acme Corp/);
  });

  it("carries the verify link exactly once in the plain-text body", () => {
    const { text } = verifyFollowEmailContent({ companyName: "Acme Corp", verifyUrl: VERIFY_URL });
    const occurrences = text.split(VERIFY_URL).length - 1;
    assert.equal(occurrences, 1);
  });

  it("carries the verify link in the html body", () => {
    const { html } = verifyFollowEmailContent({ companyName: "Acme Corp", verifyUrl: VERIFY_URL });
    assert.match(html, new RegExp(`href="${VERIFY_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });

  it("tells the reader how to back out", () => {
    const { text } = verifyFollowEmailContent({ companyName: "Acme Corp", verifyUrl: VERIFY_URL });
    assert.match(text, /if you didn't ask for this, ignore this email/i);
  });

  // Class guard, not an instance check: a second company name proves the
  // template is company-agnostic rather than hardcoded to the one used above.
  it("works for a second, differently-shaped company name", () => {
    const { subject, text } = verifyFollowEmailContent({
      companyName: "Bob's Discount Furniture",
      verifyUrl: VERIFY_URL,
    });
    assert.match(subject, /Bob's Discount Furniture/);
    assert.match(text, /Bob's Discount Furniture/);
  });

  it("carries no machinery jargon", () => {
    const { subject, text, html } = verifyFollowEmailContent({ companyName: "Acme Corp", verifyUrl: VERIFY_URL });
    for (const body of [subject, text, html]) {
      assert.doesNotMatch(body, /\bmcp\b/i);
      assert.doesNotMatch(body, /\bagents?\b/i);
      assert.doesNotMatch(body, /\bai\b/i);
    }
  });
});

describe("sendVerifyFollowEmail", () => {
  it("wraps sendEmail with kind verify_follow and never throws without a RESEND key", async () => {
    // `tsx --test` never loads `.env.local`, so RESEND_API_KEY is genuinely
    // unset here — the same no-op-before-any-I/O posture email-send.test.ts
    // relies on. This proves the wrapper reaches sendEmail's preflight
    // (which never throws) rather than skipping it.
    await assert.doesNotReject(() =>
      sendVerifyFollowEmail({ email: "person@example.com", companyName: "Acme Corp", verifyUrl: VERIFY_URL }),
    );
  });
});

describe("resolveSendPreflight — verify_follow is transactional (no unsubscribe url required)", () => {
  it("proceeds without an unsubscribe url, key and from address present", () => {
    const result = resolveSendPreflight({
      hasApiKey: true,
      hasFrom: true,
      hasUnsubscribeUrl: false,
      to: "person@example.com",
      kind: "verify_follow",
    });
    assert.equal(result, null);
  });

  it("still refuses without a from address, same as every other kind", () => {
    const result = resolveSendPreflight({
      hasApiKey: true,
      hasFrom: false,
      hasUnsubscribeUrl: false,
      to: "person@example.com",
      kind: "verify_follow",
    });
    assert.equal(result, "missing-from-address");
  });

  // Pins the pre-existing rule this change must not disturb: digest still
  // requires an unsubscribe url even after verify_follow is added alongside it.
  it("digest still requires an unsubscribe url, unchanged", () => {
    const result = resolveSendPreflight({
      hasApiKey: true,
      hasFrom: true,
      hasUnsubscribeUrl: false,
      to: "person@example.com",
      kind: "digest",
    });
    assert.equal(result, "missing-unsubscribe-url");
  });
});
