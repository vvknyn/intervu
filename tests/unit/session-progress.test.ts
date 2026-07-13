import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AnswerCritique } from "../../src/types/index";
import {
  prepSessionReducer,
  buildSessionSummary,
  serializeSessionState,
  parseSessionState,
  sessionStorageKey,
  isRevealGenerationFailure,
  resolveSessionJobContext,
  sessionJobContextText,
} from "../../src/lib/prep/session-progress";
import { buildPrepJobContextFromLegacy } from "../../src/lib/prep/job-context";

const PLAN_KEY = "test_plan_key";
const QUESTION_IDS = ["q1", "q2", "q3"];

function startSession(mode: "learn" | "practice" = "learn") {
  return prepSessionReducer(null, {
    type: "START",
    planCacheKey: PLAN_KEY,
    mode,
    questionIds: QUESTION_IDS,
  })!;
}

function mockCritique(score: number, scoreLabel = "Solid"): AnswerCritique {
  return {
    reaction: "Nice work",
    the_one_thing: "Add detail",
    say_it_like_this: "I built...",
    encouragement: "Keep going",
    score,
    scoreLabel,
  };
}

describe("START", () => {
  it("initializes all questions as unreviewed", () => {
    const state = startSession();
    assert.equal(state.questionIds.length, 3);
    for (const id of QUESTION_IDS) {
      assert.equal(state.questions[id].status, "unreviewed");
      assert.equal(state.questions[id].starred, false);
    }
    assert.equal(state.currentIndex, 0);
    assert.equal(state.version, 1);
    assert.equal(state.planCacheKey, PLAN_KEY);
  });

  it("persists jobContext when provided", () => {
    const jobContext = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Build distributed systems",
    });
    const state = prepSessionReducer(null, {
      type: "START",
      planCacheKey: PLAN_KEY,
      mode: "learn",
      questionIds: QUESTION_IDS,
      jobContext,
    })!;
    assert.equal(state.jobContext?.content.originalJd, "Build distributed systems");
    assert.equal(state.jobContext?.identity.companyName, "Acme");
  });
});

describe("REVEAL", () => {
  it("sets question status to revealed with content", () => {
    let state = startSession();
    state = prepSessionReducer(state, {
      type: "REVEAL",
      questionId: "q1",
      revealedContent: "<p>Answer</p>",
    })!;
    assert.equal(state.questions.q1.status, "revealed");
    assert.ok(state.questions.q1.revealedAt);
    assert.equal(state.questions.q1.revealedContent, "<p>Answer</p>");
  });
});

describe("Learn flow MARK_REVIEWED", () => {
  it("marks a revealed question as reviewed", () => {
    let state = startSession("learn");
    state = prepSessionReducer(state, {
      type: "REVEAL",
      questionId: "q1",
      revealedContent: "<p>Answer</p>",
    })!;
    state = prepSessionReducer(state, { type: "MARK_REVIEWED", questionId: "q1" })!;
    assert.equal(state.questions.q1.status, "reviewed");
  });
});

describe("Practice SET_ANSWER + SET_CRITIQUE", () => {
  it("records answer and critique", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "My answer",
    })!;
    assert.equal(state.questions.q1.status, "answered");
    assert.equal(state.questions.q1.answerText, "My answer");

    state = prepSessionReducer(state, {
      type: "SET_CRITIQUE",
      questionId: "q1",
      critique: mockCritique(8, "Strong"),
    })!;
    assert.equal(state.questions.q1.status, "critiqued");
    assert.equal(state.questions.q1.critique?.score, 8);
  });
});

describe("RETRY", () => {
  it("clears critique but keeps answer", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "My answer",
    })!;
    state = prepSessionReducer(state, {
      type: "SET_CRITIQUE",
      questionId: "q1",
      critique: mockCritique(4),
    })!;
    state = prepSessionReducer(state, { type: "RETRY", questionId: "q1" })!;
    assert.equal(state.questions.q1.status, "retried");
    assert.equal(state.questions.q1.answerText, "My answer");
    assert.equal(state.questions.q1.critique, undefined);
  });
});

describe("SKIP", () => {
  it("marks question as skipped", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, { type: "SKIP", questionId: "q2" })!;
    assert.equal(state.questions.q2.status, "skipped");
  });
});

describe("buildSessionSummary progress counts", () => {
  it("aggregates learn and practice progress", () => {
    let state = startSession("learn");
    state = prepSessionReducer(state, {
      type: "REVEAL",
      questionId: "q1",
      revealedContent: "<p>Answer</p>",
    })!;
    state = prepSessionReducer(state, { type: "MARK_REVIEWED", questionId: "q1" })!;
    state = prepSessionReducer(state, { type: "PRACTICE_ONE", questionId: "q1" })!;
    state = prepSessionReducer(state, { type: "TOGGLE_STAR", questionId: "q2" })!;

    const learnSummary = buildSessionSummary(state);
    assert.equal(learnSummary.progress.reviewed, 1);
    assert.equal(learnSummary.progress.revealed, 0);
    assert.equal(learnSummary.progress.practiced, 1);
    assert.equal(learnSummary.progress.starred, 1);
    assert.equal(learnSummary.progress.unreviewed, 2);

    let practiceState = startSession("practice");
    practiceState = prepSessionReducer(practiceState, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "A1",
    })!;
    practiceState = prepSessionReducer(practiceState, {
      type: "SET_CRITIQUE",
      questionId: "q1",
      critique: mockCritique(9),
    })!;
    practiceState = prepSessionReducer(practiceState, { type: "RETRY", questionId: "q2" })!;
    practiceState = prepSessionReducer(practiceState, { type: "SKIP", questionId: "q3" })!;

    const practiceSummary = buildSessionSummary(practiceState);
    assert.equal(practiceSummary.progress.completed, 1);
    assert.equal(practiceSummary.progress.retried, 1);
    assert.equal(practiceSummary.progress.skipped, 1);
  });
});

describe("buildSessionSummary output shapes", () => {
  it("learn summary exposes learn progress counts and empty performance scores", () => {
    let state = startSession("learn");
    state = prepSessionReducer(state, {
      type: "REVEAL",
      questionId: "q1",
      revealedContent: "<p>Answer</p>",
    })!;
    state = prepSessionReducer(state, { type: "MARK_REVIEWED", questionId: "q1" })!;

    const summary = buildSessionSummary(state);
    assert.equal(summary.mode, "learn");
    assert.equal(typeof summary.progress.reviewed, "number");
    assert.equal(typeof summary.progress.revealed, "number");
    assert.equal(typeof summary.progress.practiced, "number");
    assert.equal(typeof summary.progress.starred, "number");
    assert.equal(typeof summary.progress.unreviewed, "number");
    assert.equal(summary.progress.completed, 0);
    assert.equal(summary.progress.retried, 0);
    assert.equal(summary.progress.skipped, 0);
    assert.equal(summary.performance.critiquedCount, 0);
    assert.equal(summary.performance.averageScore, null);
    assert.deepEqual(summary.performance.scoreLabelCounts, {});
    assert.deepEqual(summary.performance.strongestQuestionIds, []);
    assert.deepEqual(summary.performance.focusQuestionIds, []);
  });

  it("practice summary exposes practice progress and performance metrics", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "A1",
    })!;
    state = prepSessionReducer(state, {
      type: "SET_CRITIQUE",
      questionId: "q1",
      critique: mockCritique(9, "Strong"),
    })!;
    state = prepSessionReducer(state, { type: "SKIP", questionId: "q2" })!;

    const summary = buildSessionSummary(state);
    assert.equal(summary.mode, "practice");
    assert.equal(typeof summary.progress.completed, "number");
    assert.equal(typeof summary.progress.retried, "number");
    assert.equal(typeof summary.progress.skipped, "number");
    assert.equal(summary.performance.critiquedCount, 1);
    assert.equal(summary.performance.averageScore, 9);
    assert.ok("Strong" in summary.performance.scoreLabelCounts);
    assert.ok(Array.isArray(summary.performance.strongestQuestionIds));
    assert.ok(summary.performance.focusQuestionIds.includes("q2"));
  });
});

describe("buildSessionSummary performance average excludes skipped", () => {
  it("averages only critiqued scores, not skipped", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "A1",
    })!;
    state = prepSessionReducer(state, {
      type: "SET_CRITIQUE",
      questionId: "q1",
      critique: mockCritique(8),
    })!;
    state = prepSessionReducer(state, { type: "SKIP", questionId: "q2" })!;
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q3",
      answerText: "A3",
    })!;
    state = prepSessionReducer(state, {
      type: "SET_CRITIQUE",
      questionId: "q3",
      critique: mockCritique(6),
    })!;

    const summary = buildSessionSummary(state);
    assert.equal(summary.performance.critiquedCount, 2);
    assert.equal(summary.performance.averageScore, 7);
    assert.ok(summary.performance.focusQuestionIds.includes("q2"));
  });
});

describe("isRevealGenerationFailure", () => {
  it("detects placeholder and sentinel error text", () => {
    assert.equal(isRevealGenerationFailure(""), true);
    assert.equal(isRevealGenerationFailure("   "), true);
    assert.equal(isRevealGenerationFailure("Error generating text."), true);
    assert.equal(isRevealGenerationFailure("AUTH_REQUIRED: Sign in"), true);
    assert.equal(isRevealGenerationFailure("OUT_OF_CREDITS: Add a key"), true);
    assert.equal(isRevealGenerationFailure("**Situation:** I led a team"), false);
  });
});

describe("parseSessionState round-trip", () => {
  it("serializes and restores session state", () => {
    let state = startSession("practice");
    state = prepSessionReducer(state, {
      type: "SET_ANSWER",
      questionId: "q1",
      answerText: "Saved",
    })!;
    const raw = serializeSessionState(state);
    assert.equal(sessionStorageKey(PLAN_KEY), `intervu_prep_session_v1_${PLAN_KEY}`);

    const restored = parseSessionState(raw);
    assert.deepEqual(restored, state);
  });

  it("serializes and restores jobContext", () => {
    const jobContext = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Own the API platform",
    });
    const state = prepSessionReducer(null, {
      type: "START",
      planCacheKey: PLAN_KEY,
      mode: "practice",
      questionIds: QUESTION_IDS,
      jobContext,
    })!;
    const restored = parseSessionState(serializeSessionState(state));
    assert.equal(restored?.jobContext?.content.originalJd, "Own the API platform");
  });

  it("returns null for corrupt JSON", () => {
    assert.equal(parseSessionState("{not json"), null);
    assert.equal(parseSessionState(JSON.stringify({ version: 2 })), null);
  });
});

describe("resolveSessionJobContext", () => {
  it("restores stored JD and session mode", () => {
    const jobContext = buildPrepJobContextFromLegacy({
      company: "Acme",
      position: "Engineer",
      round: "Technical",
      jobContextText: "Ship reliable services",
    });
    const state = prepSessionReducer(null, {
      type: "START",
      planCacheKey: PLAN_KEY,
      mode: "practice",
      questionIds: QUESTION_IDS,
      jobContext,
    })!;

    const restored = resolveSessionJobContext(state, "Acme", "Engineer", "Technical");
    assert.equal(restored.content.originalJd, "Ship reliable services");
    assert.equal(restored.interview.sessionMode, "practice");
  });

  it("returns empty JD for legacy sessions without stored jobContext", () => {
    const state = startSession("learn");
    const restored = resolveSessionJobContext(state, "Acme", "Engineer", "Technical");
    assert.equal(restored.content.originalJd, undefined);
    assert.equal(sessionJobContextText(state), "");
    assert.equal(restored.interview.sessionMode, "learn");
  });
});
