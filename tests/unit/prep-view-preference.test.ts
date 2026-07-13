import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getPreferredView,
  setPreferredView,
  __testClearPreferredViews,
} from "../../src/lib/prep/plan-list";

process.env.NODE_ENV = "test";

describe("prep view preference", () => {
  beforeEach(() => {
    __testClearPreferredViews();
  });

  it("returns null when no preference is stored", () => {
    assert.equal(getPreferredView("google_swe_technical"), null);
  });

  it("round-trips session preference per plan cache key", () => {
    setPreferredView("google_swe_technical", "session");
    assert.equal(getPreferredView("google_swe_technical"), "session");
    assert.equal(getPreferredView("meta_pm_behavioral"), null);
  });

  it("round-trips package preference and overwrites prior value", () => {
    setPreferredView("acme_swe_onsite", "session");
    setPreferredView("acme_swe_onsite", "package");
    assert.equal(getPreferredView("acme_swe_onsite"), "package");
  });
});
