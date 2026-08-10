import assert from "node:assert/strict";
import { test } from "node:test";
import { titleCaseDisplay } from "../../src/lib/jobs/presentation";

test("title-cases an all-uppercase string", () => {
  assert.equal(titleCaseDisplay("WARSZAWA, POLAND"), "Warszawa, Poland");
});

test("title-cases an all-lowercase string", () => {
  assert.equal(titleCaseDisplay("orange"), "Orange");
});

// The class of bug this guards, not just the instance: any deliberately
// mixed-case name must survive untouched, not just the one example seen live.
test("leaves deliberately mixed-case names untouched", () => {
  assert.equal(titleCaseDisplay("eBay"), "eBay");
  assert.equal(titleCaseDisplay("McDonald's"), "McDonald's");
});

test("leaves already-normal title case untouched", () => {
  assert.equal(titleCaseDisplay("Warszawa, Poland"), "Warszawa, Poland");
});
