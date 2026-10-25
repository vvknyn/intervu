import test from "node:test";
import assert from "node:assert/strict";
import { parseSalaryMinDraft } from "../../src/components/jobs/SerpFilters";

test("a typed salary floor commits digits only: never negative, never NaN", () => {
    assert.equal(parseSalaryMinDraft("65000"), 65000);
    assert.equal(parseSalaryMinDraft("$65,000"), 65000);
    assert.equal(parseSalaryMinDraft("-5"), 5);
    assert.equal(parseSalaryMinDraft("abc"), 0);
    assert.equal(parseSalaryMinDraft(""), 0);
    assert.ok(parseSalaryMinDraft("-100") >= 0);
});
