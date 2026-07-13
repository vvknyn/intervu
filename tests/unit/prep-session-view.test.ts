import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getSessionQuestionLabel,
  shouldShowLearnActions,
} from "../../src/components/prep/PrepSessionView";

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
