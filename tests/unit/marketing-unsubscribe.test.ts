/**
 * The "marketing_update" scope end of `unsubscribe-token.ts`'s generic
 * sign/verify mechanism. Tamper-detection and malformed-token handling are
 * already covered generically (across every `UnsubscribeScope`, including
 * this one) by `email-unsubscribe-token.test.ts` — not re-tested here.
 * What's new for THIS PR is the "marketing_update" enum value itself: these
 * tests prove it flows through the existing mechanism with no special-casing
 * required, using a scope other than the ones that test file already covers
 * (digest/waitlist_confirm) — the class, not just the instance.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

const TEST_KEY = "b".repeat(64);
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("marketing_update unsubscribe token", () => {
  it("round-trips email + the marketing_update scope", () => {
    const token = signUnsubscribeToken("Person@Example.com", "marketing_update");
    assert.ok(token);
    assert.deepEqual(verifyUnsubscribeToken(token!), { email: "person@example.com", kind: "marketing_update" });
  });

  it("a marketing_update token is rejected when verify() is pinned to a different scope", () => {
    const token = signUnsubscribeToken("person@example.com", "marketing_update")!;
    assert.equal(verifyUnsubscribeToken(token, "digest"), null);
    assert.deepEqual(verifyUnsubscribeToken(token, "marketing_update"), {
      email: "person@example.com",
      kind: "marketing_update",
    });
  });

  it("a token minted for a different scope is rejected when pinned to marketing_update — cross-identity, not just cross-kind", () => {
    const digestToken = signUnsubscribeToken("person@example.com", "digest")!;
    assert.equal(verifyUnsubscribeToken(digestToken, "marketing_update"), null);
  });

  it("a marketing_update token signed for one address never verifies as a different address", () => {
    const tokenForAlice = signUnsubscribeToken("alice@example.com", "marketing_update")!;
    const payload = verifyUnsubscribeToken(tokenForAlice, "marketing_update");
    assert.ok(payload);
    assert.notEqual(payload!.email, "bob@example.com");
    assert.equal(payload!.email, "alice@example.com");
  });
});
