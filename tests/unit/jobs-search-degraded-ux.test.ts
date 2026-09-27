import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isOperatorSearchNote,
  isSearchUnhealthy,
  jobsNotConnectedPanelCopy,
  userFacingSearchErrorMessage,
  SEARCH_UNAVAILABLE_MESSAGE,
} from "../../src/lib/jobs/result-state";
import { shouldShowSearchAlertCapture } from "../../src/lib/jobs/search-alert-capture";

const PAGE = join(__dirname, "..", "..", "src", "app", "jobs", "page.tsx");

describe("jobs search degraded UX helpers", () => {
  it("flags operator setup notes", () => {
    assert.equal(isOperatorSearchNote("MEILISEARCH_HOST not set"), true);
    assert.equal(
      isOperatorSearchNote(
        "Job search isn't connected yet. Set MEILISEARCH_HOST (production) or JOBS_PREVIEW_FROM_SNAPSHOT=1",
      ),
      true,
    );
    assert.equal(isOperatorSearchNote(SEARCH_UNAVAILABLE_MESSAGE), false);
  });

  it("replaces operator notes with the user-safe unavailable message", () => {
    assert.equal(
      userFacingSearchErrorMessage("MEILISEARCH_HOST not set"),
      SEARCH_UNAVAILABLE_MESSAGE,
    );
    assert.equal(userFacingSearchErrorMessage("Network hiccup — try again."), "Network hiccup — try again.");
  });

  it("isSearchUnhealthy covers error, unavailable, and unconfigured", () => {
    assert.equal(isSearchUnhealthy({ searchError: "x", result: null }), true);
    assert.equal(
      isSearchUnhealthy({ searchError: null, result: { configured: true, unavailable: true } }),
      true,
    );
    assert.equal(
      isSearchUnhealthy({ searchError: null, result: { configured: false, unavailable: undefined } }),
      true,
    );
    assert.equal(
      isSearchUnhealthy({ searchError: null, result: { configured: true, unavailable: undefined } }),
      false,
    );
  });

  it("jobsNotConnectedPanelCopy hides operator env detail outside development", () => {
    const prod = jobsNotConnectedPanelCopy({
      isDev: false,
      operatorNote: "Set MEILISEARCH_HOST (production)",
    });
    assert.equal(prod.body, SEARCH_UNAVAILABLE_MESSAGE);
    assert.equal(prod.operatorDetail, null);
    assert.match(prod.title, /can't load results/i);
    assert.doesNotMatch(prod.body, /MEILISEARCH_HOST/i);
    assert.doesNotMatch(prod.body, /\bvelai\b/);

    const dev = jobsNotConnectedPanelCopy({
      isDev: true,
      operatorNote: "Set MEILISEARCH_HOST",
    });
    assert.match(dev.body, /Velai/);
    assert.equal(dev.operatorDetail, "Set MEILISEARCH_HOST");
  });

  it("shouldShowSearchAlertCapture suppresses when search is unhealthy", () => {
    assert.equal(
      shouldShowSearchAlertCapture({
        signedIn: false,
        dismissed: false,
        submitted: false,
        interactions: 0,
        hasResults: false,
        searchUnhealthy: true,
      }),
      false,
    );
  });
});

describe("jobs page wiring", () => {
  it("gates persistence actions and sanitizes operator notes in UI", () => {
    const src = readFileSync(PAGE, "utf8");
    assert.match(src, /canUseSearchPersistenceActions = canSaveSearch && !searchUnhealthy/);
    assert.match(src, /userFacingSearchErrorMessage\(searchError\)/);
    assert.match(src, /disabled=\{searchUnhealthy\}/);
    const notConnected = src.slice(
      src.indexOf('resultsPanel === "not-connected"'),
      src.indexOf('resultsPanel === "error"'),
    );
    assert.match(src, /notConnectedPanel = jobsNotConnectedPanelCopy/);
    assert.match(notConnected, /border-brand/);
    assert.doesNotMatch(notConnected, /border-foreground/);
    assert.doesNotMatch(notConnected, /\bvelai\b/);
    assert.match(src, /variant="link"[\s\S]*Try again/);
  });
});

describe("TopBar lean Sign in focus", () => {
  it("uses emphasized chrome focus ring on filled brand CTA", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "components", "layout", "TopBar.tsx"), "utf8");
    const leanSignIn = src.slice(src.indexOf("leanSurface ?"), src.indexOf(") : (", src.indexOf("leanSurface ?")));
    assert.match(leanSignIn, /CHROME_FOCUS_ON_BRAND/);
  });
});
