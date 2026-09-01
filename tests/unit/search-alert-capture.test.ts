import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowSearchAlertCapture,
  SHOW_AFTER_INTERACTIONS,
  COOLDOWN_MS,
} from "../../src/lib/jobs/search-alert-capture";

describe("shouldShowSearchAlertCapture", () => {
  it("never shows when signed in", () => {
    assert.equal(
      shouldShowSearchAlertCapture({
        signedIn: true,
        dismissed: false,
        submitted: false,
        interactions: 99,
        hasResults: true,
      }),
      false,
    );
  });

  it("shows immediately on zero results when signed out", () => {
    assert.equal(
      shouldShowSearchAlertCapture({
        signedIn: false,
        dismissed: false,
        submitted: false,
        interactions: 0,
        hasResults: false,
      }),
      true,
    );
  });

  it("waits for interactions on results surface", () => {
    assert.equal(
      shouldShowSearchAlertCapture({
        signedIn: false,
        dismissed: false,
        submitted: false,
        interactions: SHOW_AFTER_INTERACTIONS - 1,
        hasResults: true,
      }),
      false,
    );
    assert.equal(
      shouldShowSearchAlertCapture({
        signedIn: false,
        dismissed: false,
        submitted: false,
        interactions: SHOW_AFTER_INTERACTIONS,
        hasResults: true,
      }),
      true,
    );
  });

  it("respects dismissed and submitted flags", () => {
    const base = {
      signedIn: false,
      interactions: 5,
      hasResults: true,
    };
    assert.equal(shouldShowSearchAlertCapture({ ...base, dismissed: true, submitted: false }), false);
    assert.equal(shouldShowSearchAlertCapture({ ...base, dismissed: false, submitted: true }), false);
  });
});

describe("search alert cooldown constant", () => {
  it("is 30 days", () => {
    assert.equal(COOLDOWN_MS, 30 * 24 * 60 * 60 * 1000);
  });
});
