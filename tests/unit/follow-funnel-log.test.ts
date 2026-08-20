import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFollowFunnelEntry,
  FOLLOW_FUNNEL_STEPS,
  recordFollowFunnelStep,
  type FollowFunnelStep,
} from "../../src/lib/follows/funnel-log";
import { recordFollowFunnelAction } from "../../src/actions/follow-funnel";

const NOW = Date.parse("2026-08-19T12:00:00Z");

describe("buildFollowFunnelEntry — shape", () => {
  it("carries the step, optional companyDomain, and a createdAt timestamp", () => {
    const entry = buildFollowFunnelEntry({ step: "cta_click", companyDomain: "acme.com" }, NOW);
    assert.deepEqual(entry, { step: "cta_click", companyDomain: "acme.com", createdAt: "2026-08-19T12:00:00.000Z" });
  });

  it("omits companyDomain when not given, rather than writing it as undefined", () => {
    const entry = buildFollowFunnelEntry({ step: "unsubscribed" }, NOW);
    assert.deepEqual(entry, { step: "unsubscribed", createdAt: "2026-08-19T12:00:00.000Z" });
  });

  // Class guard, not an instance check: every declared step builds the
  // same well-formed shape, not just the one used above.
  it("builds a well-formed entry for every declared step", () => {
    for (const step of FOLLOW_FUNNEL_STEPS) {
      const entry = buildFollowFunnelEntry({ step }, NOW);
      assert.ok(entry);
      assert.equal(entry.step, step);
      assert.equal(entry.createdAt, "2026-08-19T12:00:00.000Z");
    }
  });
});

describe("buildFollowFunnelEntry — runtime guard against an unknown step", () => {
  it("returns null for a step that bypassed the type (e.g. a raw client call)", () => {
    const bad = "not_a_real_step" as FollowFunnelStep;
    assert.equal(buildFollowFunnelEntry({ step: bad }, NOW), null);
  });
});

describe("recordFollowFunnelStep — never throws", () => {
  it("resolves even with no Firebase admin credentials configured (tsx --test never loads .env.local)", async () => {
    await assert.doesNotReject(() => recordFollowFunnelStep({ step: "follow_click", companyDomain: "acme.com" }));
  });

  it("resolves (silently) for an unknown step rather than writing garbage", async () => {
    const bad = "not_a_real_step" as FollowFunnelStep;
    await assert.doesNotReject(() => recordFollowFunnelStep({ step: bad }));
  });
});

describe("recordFollowFunnelAction — server action never throws to the caller", () => {
  it("resolves even when the underlying write would reject (beyond-primary case: the action layer, not just the writer)", async () => {
    await assert.doesNotReject(() => recordFollowFunnelAction("email_verified", "acme.com"));
  });

  it("resolves without a companyDomain too", async () => {
    await assert.doesNotReject(() => recordFollowFunnelAction("unsubscribed"));
  });
});
