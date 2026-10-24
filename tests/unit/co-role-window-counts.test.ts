import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleCountLabel, showMoreLabel } from "../../src/lib/companies/presentation";

const base = { displayed: 10, matched: 196, hasQuery: false, openCountLabel: "1,577", windowSize: 196 as number | null };

describe("company role window counts", () => {
  it("196 loaded / 1,577 open: no query keeps 'N of open shown'", () => {
    assert.equal(roleCountLabel(base), "10 of 1,577 shown");
  });
  it("196 loaded / 1,577 open: a query says it covered only the listed roles", () => {
    assert.equal(roleCountLabel({ ...base, hasQuery: true, matched: 3, displayed: 3 }), "3 of the 196 roles listed here match");
    assert.equal(roleCountLabel({ ...base, hasQuery: true, matched: 1, displayed: 1 }), "1 of the 196 roles listed here matches");
  });
  it("40 loaded / 40 open: no window wording, today's copy", () => {
    const full = { ...base, openCountLabel: "40", windowSize: null, hasQuery: true };
    assert.equal(roleCountLabel({ ...full, matched: 5, displayed: 5 }), "5 matches");
    assert.equal(roleCountLabel({ ...full, matched: 1, displayed: 1 }), "1 match");
    assert.equal(roleCountLabel({ ...full, matched: 40, displayed: 10 }), "10 of 40 matches shown");
    assert.doesNotMatch(roleCountLabel({ ...full, matched: 5, displayed: 5 }), /listed here/);
  });
  it("expand button names the increment, singular for one", () => {
    assert.equal(showMoreLabel(186), "Show 186 more roles");
    assert.equal(showMoreLabel(1), "Show 1 more role");
    assert.equal(showMoreLabel(30), "Show 30 more roles");
  });
});
