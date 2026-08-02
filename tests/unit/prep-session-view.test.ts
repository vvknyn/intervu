import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSessionQuestionLabel,
  sessionStateAfterMarkReviewed,
  shouldShowLearnActions,
  sessionAnchorLine,
  sessionPlanRowStatus,
  planRowLabel,
} from "../../src/components/prep/PrepSessionView";
import {
  buildSessionSummary,
  prepSessionReducer,
} from "../../src/lib/prep/session-progress";
import { emptyPrepJobContext } from "../../src/lib/prep/job-context";
import type { PrepSessionQuestionProgress } from "../../src/lib/prep/session-progress";
import type { QuestionItem } from "../../src/types";

describe("getSessionQuestionLabel", () => {
  it("returns Question X of N format", () => {
    assert.equal(getSessionQuestionLabel(0, 5), "Question 1 of 5");
    assert.equal(getSessionQuestionLabel(2, 10), "Question 3 of 10");
    assert.equal(getSessionQuestionLabel(4, 5), "Question 5 of 5");
  });
});

describe("shouldShowLearnActions", () => {
  it("requires revealed content for learn CTAs", () => {
    assert.equal(
      shouldShowLearnActions("learn", {
        questionId: "q1",
        status: "revealed",
        starred: false,
        revealedAt: "2026-01-01T00:00:00.000Z",
      }),
      false,
    );
    assert.equal(
      shouldShowLearnActions("learn", {
        questionId: "q1",
        status: "revealed",
        starred: false,
        revealedContent: "<p>Answer</p>",
      }),
      true,
    );
    assert.equal(
      shouldShowLearnActions("learn", {
        questionId: "q1",
        status: "reviewed",
        starred: false,
        revealedContent: "<p>Answer</p>",
      }),
      true,
    );
    assert.equal(
      shouldShowLearnActions("practice", {
        questionId: "q1",
        status: "revealed",
        starred: false,
        revealedContent: "<p>Answer</p>",
      }),
      false,
    );
  });
});

describe("sessionStateAfterMarkReviewed", () => {
  it("includes final learn question in summary snapshot state", () => {
    let state = prepSessionReducer(null, {
      type: "START",
      planCacheKey: "plan",
      mode: "learn",
      questionIds: ["q1"],
    })!;
    state = prepSessionReducer(state, {
      type: "REVEAL",
      questionId: "q1",
      revealedContent: "<p>Answer</p>",
    })!;

    const staleSummary = buildSessionSummary(state);
    assert.equal(staleSummary.progress.reviewed, 0);

    const finishState = sessionStateAfterMarkReviewed(state, "q1");
    const finishSummary = buildSessionSummary(finishState);
    assert.equal(finishState.questions.q1.status, "reviewed");
    assert.equal(finishSummary.progress.reviewed, 1);
  });
});

describe("sessionAnchorLine", () => {
  it("is null for a generic session (no company/job title)", () => {
    assert.equal(sessionAnchorLine(emptyPrepJobContext("", "", "Technical")), null);
  });

  it("is null when only one of company/job title is present", () => {
    assert.equal(sessionAnchorLine(emptyPrepJobContext("Microsoft", "", "Technical")), null);
    assert.equal(sessionAnchorLine(emptyPrepJobContext("", "Senior Product Designer", "Technical")), null);
  });

  it("renders 'anchored to · {title} · {company}' when the session has a real job anchor", () => {
    const ctx = emptyPrepJobContext("Microsoft", "Senior Product Designer", "Technical");
    assert.equal(sessionAnchorLine(ctx), "anchored to · Senior Product Designer · Microsoft");
  });
});

describe("sessionPlanRowStatus", () => {
  function progress(status: PrepSessionQuestionProgress["status"]): PrepSessionQuestionProgress {
    return { questionId: "q1", status, starred: false };
  }

  it("is 'current' for the current question regardless of its stored status", () => {
    assert.equal(sessionPlanRowStatus(progress("critiqued"), true), "current");
    assert.equal(sessionPlanRowStatus(undefined, true), "current");
  });

  it("is 'done' for a non-current question in a terminal state this pass", () => {
    for (const status of ["reviewed", "critiqued", "skipped"] as const) {
      assert.equal(sessionPlanRowStatus(progress(status), false), "done", status);
    }
  });

  it("is 'pending' for a non-current question that hasn't finished this pass, including retried", () => {
    for (const status of ["unreviewed", "revealed", "answered", "retried"] as const) {
      assert.equal(sessionPlanRowStatus(progress(status), false), "pending", status);
    }
    assert.equal(sessionPlanRowStatus(undefined, false), "pending");
  });
});

describe("planRowLabel", () => {
  function makeQuestion(overrides: Partial<QuestionItem> = {}): QuestionItem {
    return { id: "q1", question: "Tell me about a time you owned a project end to end.", category: "Behavioral", ...overrides };
  }

  it("uses the real topics[0] tag when the question was generated with one", () => {
    assert.equal(planRowLabel(makeQuestion({ topics: ["ownership", "leadership"] })), "ownership");
  });

  it("falls back to the real question text (untruncated) when there are no topics", () => {
    assert.equal(planRowLabel(makeQuestion({ question: "Short question?" })), "Short question?");
  });

  it("truncates a long question rather than fabricating a paraphrase", () => {
    const long = "Tell me about a time you had to navigate a difficult cross-team disagreement.";
    const label = planRowLabel(makeQuestion({ question: long }));
    assert.ok(label.endsWith("…"), "should be truncated with an ellipsis");
    assert.ok(long.startsWith(label.slice(0, -1)), "truncated text should be a real prefix of the question");
  });
});
