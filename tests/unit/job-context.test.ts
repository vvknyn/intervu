import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPrepJobContext,
  fingerprintJobContext,
  stableSerializeJobContext,
  buildPrepJobContextFromLegacy,
} from "../../src/lib/prep/job-context";

describe("emptyPrepJobContext", () => {
  it("sets required identity and interview fields", () => {
    const ctx = emptyPrepJobContext("Acme", "Engineer", "Technical");
    assert.equal(ctx.identity.companyName, "Acme");
    assert.equal(ctx.identity.jobTitle, "Engineer");
    assert.equal(ctx.interview.round, "Technical");
    assert.deepEqual(ctx.candidate, {});
    assert.deepEqual(ctx.artifacts, {});
    assert.deepEqual(ctx.content, {});
    assert.deepEqual(ctx.provenance, {});
  });
});

describe("fingerprintJobContext", () => {
  it("is stable for identical context", () => {
    const a = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    const b = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    assert.equal(fingerprintJobContext(a), fingerprintJobContext(b));
  });

  it("changes when JD text changes", () => {
    const a = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build APIs",
    });
    const b = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build ML pipelines",
    });
    assert.notEqual(fingerprintJobContext(a), fingerprintJobContext(b));
  });
});

describe("optional fields", () => {
  it("does not throw when optional fields are missing", () => {
    const ctx = emptyPrepJobContext("Acme", "Engineer", "Technical");
    assert.doesNotThrow(() => stableSerializeJobContext(ctx));
    assert.doesNotThrow(() => fingerprintJobContext(ctx));

    const legacy = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
    });
    assert.doesNotThrow(() => stableSerializeJobContext(legacy));
    assert.doesNotThrow(() => fingerprintJobContext(legacy));
  });
});

describe("stableSerializeJobContext", () => {
  it("is deterministic regardless of object key insertion order", () => {
    const ctxA = {
      identity: { companyName: "Acme", jobTitle: "Engineer" },
      content: { originalJd: "Build APIs" },
      candidate: {},
      artifacts: {},
      interview: { round: "Technical" },
      provenance: {},
    };
    const ctxB = {
      provenance: {},
      interview: { round: "Technical" },
      artifacts: {},
      candidate: {},
      content: { originalJd: "Build APIs" },
      identity: { jobTitle: "Engineer", companyName: "Acme" },
    };
    assert.equal(stableSerializeJobContext(ctxA), stableSerializeJobContext(ctxB));
  });
});
