import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCacheKeyForPlan, resolveCacheLookup } from "../../src/lib/interview-cache";

describe("getCacheKeyForPlan", () => {
  it("legacy key matches when jdFingerprint is undefined", () => {
    const legacy = getCacheKeyForPlan("Google", "SWE", "Technical");
    const oldStyle = getCacheKeyForPlan("Google", "SWE", "Technical", undefined);
    assert.equal(legacy, oldStyle);
  });

  it("jd fingerprint changes the key", () => {
    const a = getCacheKeyForPlan("Google", "SWE", "Technical", "fp-aaa");
    const b = getCacheKeyForPlan("Google", "SWE", "Technical", "fp-bbb");
    assert.notEqual(a, b);
  });
});

describe("resolveCacheLookup", () => {
  it("returns distinct primary and legacy keys when JD exists", () => {
    const { primaryKey, legacyKey } = resolveCacheLookup("Google", "SWE", "Technical", "fp-1");
    assert.notEqual(primaryKey, legacyKey);
  });
});
