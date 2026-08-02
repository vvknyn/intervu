import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateWaitlistInput } from "@/actions/waitlist";
import { PACKS } from "@/lib/pricing";

describe("validateWaitlistInput()", () => {
  it("accepts a valid email + real packId", async () => {
    const r = await validateWaitlistInput({ email: "person@example.com", packId: "starter", honeypot: "" });
    assert.equal(r.kind, "valid");
    assert.equal(r.kind === "valid" && r.email, "person@example.com");
    assert.equal(r.kind === "valid" && r.packId, "starter");
  });

  it("rejects a malformed email with a real, distinguishable error", async () => {
    const r = await validateWaitlistInput({ email: "not-an-email", packId: "starter", honeypot: "" });
    assert.equal(r.kind, "invalid");
    assert.ok(r.kind === "invalid" && r.error.length > 0);
  });

  it("rejects an unknown packId", async () => {
    const r = await validateWaitlistInput({ email: "person@example.com", packId: "enterprise", honeypot: "" });
    assert.equal(r.kind, "invalid");
  });

  it("silently drops when the honeypot is filled, even with an otherwise-valid submission", async () => {
    const r = await validateWaitlistInput({ email: "person@example.com", packId: "starter", honeypot: "http://spam.example" });
    assert.deepEqual(r, { kind: "silent-drop" });
  });

  it("silently drops a bot payload even when the email is ALSO malformed (never leaks a validation error to a bot)", async () => {
    const r = await validateWaitlistInput({ email: "garbage", packId: "starter", honeypot: "x" });
    assert.deepEqual(r, { kind: "silent-drop" });
  });

  it("accepts every real pack id from PACKS (class-wide, not just 'starter')", async () => {
    for (const pack of PACKS) {
      const r = await validateWaitlistInput({ email: "person@example.com", packId: pack.id, honeypot: "" });
      assert.equal(r.kind, "valid", `expected ${pack.id} to validate`);
    }
  });
});
