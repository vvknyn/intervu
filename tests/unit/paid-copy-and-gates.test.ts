import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAID_FEATURES, paidFeaturesSentence, RESUME_PAGE_SUBCOPY } from "../../src/lib/jobs/resume-privacy-copy";
import { createPaidStatusCache } from "../../src/lib/account/paid-status";
import { effectiveResumeSummary } from "../../src/components/settings/effective-resume-summary";

describe("paid feature list is one constant that matches what the server gates", () => {
  it("names no PDF export and no rule-based tailoring (neither is gated)", () => {
    for (const item of PAID_FEATURES) assert.doesNotMatch(item, /pdf|rule-based/i);
  });
  it("the pricing card and paidFeaturesSentence read the same constant", () => {
    const pricing = readFileSync(join(__dirname, "../../src/app/pricing/pricing-client.tsx"), "utf8");
    assert.match(pricing, /PAID_FEATURES\.map/);
    assert.doesNotMatch(pricing, /const PAID_FEATURES/);
    for (const item of PAID_FEATURES) assert.ok(paidFeaturesSentence().includes(item));
    assert.ok(RESUME_PAGE_SUBCOPY.length > 0 && RESUME_PAGE_SUBCOPY.length <= 90);
  });
});

describe("createPaidStatusCache", () => {
  it("memoises within the TTL and re-asks after it", async () => {
    let calls = 0;
    let t = 0;
    const paid = createPaidStatusCache(async () => (calls++, { paid: true }), () => t);
    assert.equal(await paid(), true);
    assert.equal(await paid(), true);
    assert.equal(calls, 1);
    t = 31_000;
    await paid();
    assert.equal(calls, 2);
  });
  it("fails closed: a rejected, errored or non-true answer is unpaid", async () => {
    assert.equal(await createPaidStatusCache(async () => { throw new Error("down"); })(), false);
    assert.equal(await createPaidStatusCache(async () => ({ error: "x" }))(), false);
    assert.equal(await createPaidStatusCache(async () => ({ paid: false }))(), false);
  });
});

describe("effectiveResumeSummary", () => {
  const local = { data: { name: "A" } as never, updatedAt: "2026-10-23" };
  it("falls back to the device copy when the account answers none", () => {
    assert.equal(effectiveResumeSummary({ source: "none" } as never, local).source, "resume_data");
  });
  it("keeps the server copy when there is one, and none when neither exists", () => {
    const server = { source: "resume_data", resume_data: {}, updatedAt: "x" } as never;
    assert.equal(effectiveResumeSummary(server, local), server);
    assert.equal(effectiveResumeSummary({ source: "none" } as never, null).source, "none");
  });
  it("shows the device copy over a locked account copy, and says the account also holds one", () => {
    const out = effectiveResumeSummary({ source: "locked", updatedAt: "2026-10-01" } as never, local);
    assert.equal(out.source, "resume_data");
    assert.equal(out.accountCopyLocked, true);
    assert.equal(effectiveResumeSummary({ source: "none" } as never, local).accountCopyLocked, undefined);
  });
  it("stays locked, never none, when a saved copy is locked and the device holds none", () => {
    const server = { source: "locked", updatedAt: "2026-10-01" } as never;
    assert.equal(effectiveResumeSummary(server, null), server);
  });
});
