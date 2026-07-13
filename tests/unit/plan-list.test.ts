import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { CachedInterviewData } from "../../src/lib/interview-cache";
import {
  listCachedPlans,
  listResumableSessions,
  __testSetInterviewCacheEntries,
  __testSetSessionEntries,
} from "../../src/lib/prep/plan-list";
import { sessionStorageKey, serializeSessionState } from "../../src/lib/prep/session-progress";

process.env.NODE_ENV = "test";

function makeEntry(overrides: Partial<CachedInterviewData> = {}): CachedInterviewData {
  const now = Date.now();
  return {
    cacheKey: "google_swe_technical",
    company: "Google",
    position: "Software Engineer",
    round: "Technical",
    hasResumeContext: false,
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

describe("listCachedPlans", () => {
  beforeEach(() => {
    __testSetInterviewCacheEntries([]);
  });

  it("returns empty array when cache is empty", () => {
    assert.deepEqual(listCachedPlans(), []);
  });

  it("returns non-expired plans sorted by createdAt descending", () => {
    const older = makeEntry({
      cacheKey: "older",
      company: "Meta",
      createdAt: 1000,
      expiresAt: Date.now() + 60_000,
    });
    const newer = makeEntry({
      cacheKey: "newer",
      company: "Apple",
      createdAt: 2000,
      expiresAt: Date.now() + 60_000,
    });
    __testSetInterviewCacheEntries([older, newer]);

    const plans = listCachedPlans();
    assert.equal(plans.length, 2);
    assert.equal(plans[0].cacheKey, "newer");
    assert.equal(plans[1].cacheKey, "older");
  });

  it("filters out expired plans", () => {
    const expired = makeEntry({
      cacheKey: "expired",
      expiresAt: Date.now() - 1000,
    });
    const valid = makeEntry({
      cacheKey: "valid",
      expiresAt: Date.now() + 60_000,
    });
    __testSetInterviewCacheEntries([expired, valid]);

    const plans = listCachedPlans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].cacheKey, "valid");
  });

  it("maps list item fields from cache entries", () => {
    __testSetInterviewCacheEntries([
      makeEntry({
        cacheKey: "acme_pm_behavioral",
        company: "Acme",
        position: "Product Manager",
        round: "Behavioral",
        jdFingerprint: "fp123",
        createdAt: 5000,
        expiresAt: Date.now() + 60_000,
      }),
    ]);

    const [plan] = listCachedPlans();
    assert.equal(plan.company, "Acme");
    assert.equal(plan.position, "Product Manager");
    assert.equal(plan.round, "Behavioral");
    assert.equal(plan.jdFingerprint, "fp123");
    assert.equal(plan.createdAt, 5000);
  });
});

describe("listResumableSessions", () => {
  beforeEach(() => {
    __testSetInterviewCacheEntries([]);
    __testSetSessionEntries({});
  });

  it("returns empty array when no session keys exist", () => {
    assert.deepEqual(listResumableSessions(), []);
  });

  it("returns parsed sessions with plan metadata from cache", () => {
    const planKey = "google_swe_technical";
    __testSetInterviewCacheEntries([
      makeEntry({
        cacheKey: planKey,
        company: "Google",
        position: "Software Engineer",
        round: "Technical",
      }),
    ]);

    const session = {
      version: 1 as const,
      planCacheKey: planKey,
      mode: "learn" as const,
      startedAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      currentIndex: 0,
      questionIds: ["q1"],
      questions: {
        q1: { questionId: "q1", status: "unreviewed" as const, starred: false },
      },
    };

    __testSetSessionEntries({
      [sessionStorageKey(planKey)]: serializeSessionState(session),
    });

    const sessions = listResumableSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].planCacheKey, planKey);
    assert.equal(sessions[0].mode, "learn");
    assert.equal(sessions[0].company, "Google");
    assert.equal(sessions[0].position, "Software Engineer");
    assert.equal(sessions[0].round, "Technical");
  });
});
