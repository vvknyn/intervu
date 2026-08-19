import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSearchPrefs, shouldPromptSearchPrefsInsteadOfResume } from "../../src/lib/jobs/result-state";

test("hasSearchPrefs is false for absent, empty, or whitespace-only query", () => {
    assert.equal(hasSearchPrefs(undefined), false);
    assert.equal(hasSearchPrefs(null), false);
    assert.equal(hasSearchPrefs({}), false);
    assert.equal(hasSearchPrefs({ query: "" }), false);
    assert.equal(hasSearchPrefs({ query: "   " }), false);
});

test("hasSearchPrefs is true when query has non-whitespace content", () => {
    assert.equal(hasSearchPrefs({ query: "Software Engineer" }), true);
    assert.equal(hasSearchPrefs({ query: "  nurse  " }), true);
});

test("shouldPromptSearchPrefsInsteadOfResume when resume known absent and no prefs", () => {
    assert.equal(shouldPromptSearchPrefsInsteadOfResume(false, false), true);
});

test("shouldPromptSearchPrefsInsteadOfResume false when prefs exist", () => {
    assert.equal(shouldPromptSearchPrefsInsteadOfResume(false, true), false);
});

test("shouldPromptSearchPrefsInsteadOfResume false when resume unknown or present", () => {
    assert.equal(shouldPromptSearchPrefsInsteadOfResume(null, false), false);
    assert.equal(shouldPromptSearchPrefsInsteadOfResume(true, false), false);
    assert.equal(shouldPromptSearchPrefsInsteadOfResume(true, true), false);
});
