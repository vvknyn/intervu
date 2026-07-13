import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planHasSessionQuestions,
  resolvePlanCacheKey,
  validatePrepSetup,
} from "../../src/lib/prep/cache-key";
import { emptyPrepJobContext } from "../../src/lib/prep/job-context";
import { getCacheKeyForPlan } from "../../src/lib/interview-cache";

describe("resolvePlanCacheKey", () => {
  it("uses legacy key when no JD content", () => {
    const ctx = emptyPrepJobContext("Google", "SWE", "Technical");
    const { primaryKey, legacyKey } = resolvePlanCacheKey(ctx);
    const expected = getCacheKeyForPlan("Google", "SWE", "Technical");
    assert.equal(primaryKey, expected);
    assert.equal(legacyKey, expected);
    assert.equal(primaryKey, legacyKey);
  });

  it("uses JD fingerprint when original JD is present", () => {
    const ctx = emptyPrepJobContext("Google", "SWE", "Technical");
    ctx.content.originalJd = "Build distributed systems";
    const { primaryKey, legacyKey, jdFingerprint } = resolvePlanCacheKey(ctx);
    assert.ok(jdFingerprint);
    assert.notEqual(primaryKey, legacyKey);
    assert.equal(
      primaryKey,
      getCacheKeyForPlan("Google", "SWE", "Technical", jdFingerprint),
    );
  });

  it("shares plan key across learn and practice session modes", () => {
    const learn = emptyPrepJobContext("Google", "SWE", "Technical");
    learn.content.originalJd = "Build distributed systems";
    learn.interview.sessionMode = "learn";

    const practice = emptyPrepJobContext("Google", "SWE", "Technical");
    practice.content.originalJd = "Build distributed systems";
    practice.interview.sessionMode = "practice";
    practice.interview.completedQuestionIds = ["q1", "q2"];
    practice.interview.practiceSessionId = "sess-123";

    const learnKey = resolvePlanCacheKey(learn);
    const practiceKey = resolvePlanCacheKey(practice);

    assert.equal(learnKey.primaryKey, practiceKey.primaryKey);
    assert.equal(learnKey.jdFingerprint, practiceKey.jdFingerprint);
  });
});

describe("planHasSessionQuestions", () => {
  it("returns false when both question lists are empty", () => {
    assert.equal(planHasSessionQuestions({ questions: [] }, { questions: [], curatedCount: 0, aiGeneratedCount: 0 }), false);
    assert.equal(planHasSessionQuestions(null, null), false);
  });

  it("returns true when behavioral or system-design questions exist", () => {
    assert.equal(
      planHasSessionQuestions(
        { questions: [{ id: "q1", question: "Tell me about yourself", category: "Behavioral" }] },
        null,
      ),
      true,
    );
    assert.equal(
      planHasSessionQuestions(null, {
        questions: [{ id: "sd1", question: "Design Twitter", category: "System Design" }],
        curatedCount: 1,
        aiGeneratedCount: 0,
      }),
      true,
    );
  });
});

describe("validatePrepSetup", () => {
  it("rejects empty trimmed company, role, or round", () => {
    const ctx = emptyPrepJobContext("  ", "PM", "Behavioral");
    assert.equal(validatePrepSetup(ctx).valid, false);

    const ctx2 = emptyPrepJobContext("Acme", "  ", "Behavioral");
    assert.equal(validatePrepSetup(ctx2).valid, false);

    const ctx3 = emptyPrepJobContext("Acme", "PM", "  ");
    assert.equal(validatePrepSetup(ctx3).valid, false);
  });

  it("accepts fully trimmed role details", () => {
    const ctx = emptyPrepJobContext("  Google  ", "  SWE  ", "  Technical  ");
    assert.equal(validatePrepSetup(ctx).valid, true);
  });
});
