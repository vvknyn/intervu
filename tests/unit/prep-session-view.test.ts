import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSessionQuestionLabel } from "../../src/components/prep/PrepSessionView";

describe("getSessionQuestionLabel", () => {
  it("returns Question X of N format", () => {
    assert.equal(getSessionQuestionLabel(0, 5), "Question 1 of 5");
    assert.equal(getSessionQuestionLabel(2, 10), "Question 3 of 10");
    assert.equal(getSessionQuestionLabel(4, 5), "Question 5 of 5");
  });
});
