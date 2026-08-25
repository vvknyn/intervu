import { test } from "node:test";
import assert from "node:assert/strict";
import {
    chooseShareMethod,
    classifyShareOutcome,
    shareSurfaceFromUrl,
    shouldTrackShare,
    withShareRef,
} from "../../src/lib/share/share-decision";

// --- chooseShareMethod: which mechanism the runtime supports ---------------

test("chooseShareMethod prefers native share when both are available", () => {
    assert.equal(chooseShareMethod(true, true), "native");
});

test("chooseShareMethod falls back to clipboard when native share is absent", () => {
    assert.equal(chooseShareMethod(false, true), "clipboard");
});

test("chooseShareMethod is unsupported when neither is available", () => {
    assert.equal(chooseShareMethod(false, false), "unsupported");
});

// --- classifyShareOutcome: native-share path --------------------------------

test("classifyShareOutcome reports a completed native share as shared", () => {
    assert.equal(classifyShareOutcome("native", null), "shared");
});

// --- classifyShareOutcome: clipboard-fallback path --------------------------

test("classifyShareOutcome reports a successful clipboard write as copied", () => {
    assert.equal(classifyShareOutcome("clipboard", null), "copied");
});

// --- classifyShareOutcome: cancelled native share (AbortError) --------------

test("classifyShareOutcome treats a native AbortError as cancelled, not failed", () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    const outcome = classifyShareOutcome("native", abort);
    assert.equal(outcome, "cancelled");
    assert.notEqual(outcome, "failed");
});

test("a non-abort native error is still an honest failure, not a silent cancel", () => {
    assert.equal(classifyShareOutcome("native", new Error("share target crashed")), "failed");
});

// --- classifyShareOutcome: clipboard-rejected -------------------------------

test("classifyShareOutcome reports a rejected clipboard write as failed, never copied", () => {
    const denied = new DOMException("Write permission denied.", "NotAllowedError");
    const outcome = classifyShareOutcome("clipboard", denied);
    assert.equal(outcome, "failed");
    assert.notEqual(outcome, "copied");
});

// --- shouldTrackShare: the "never track a cancel or a failure" rule --------

test("shouldTrackShare fires for a completed native share", () => {
    assert.equal(shouldTrackShare("shared"), true);
});

test("shouldTrackShare fires for a successful clipboard copy", () => {
    assert.equal(shouldTrackShare("copied"), true);
});

test("shouldTrackShare does not fire for a cancelled share (AbortError)", () => {
    assert.equal(shouldTrackShare("cancelled"), false);
});

test("shouldTrackShare does not fire for a failed share", () => {
    assert.equal(shouldTrackShare("failed"), false);
});

// --- withShareRef / shareSurfaceFromUrl: attribution tag round-trip --------

test("withShareRef appends the surface tag to a bare URL", () => {
    assert.equal(withShareRef("https://intervuhq.com", "app"), "https://intervuhq.com?ref=share_app");
});

test("withShareRef appends with & when the URL already has a query string", () => {
    assert.equal(
        withShareRef("https://intervuhq.com/jobs/foo-123?x=1", "job"),
        "https://intervuhq.com/jobs/foo-123?x=1&ref=share_job",
    );
});

test("shareSurfaceFromUrl recovers the surface withShareRef tagged", () => {
    assert.equal(shareSurfaceFromUrl(withShareRef("https://intervuhq.com", "app")), "app");
    assert.equal(shareSurfaceFromUrl(withShareRef("https://intervuhq.com/jobs/foo-123", "job")), "job");
});

test("shareSurfaceFromUrl is null for an untagged or malformed URL", () => {
    assert.equal(shareSurfaceFromUrl("https://intervuhq.com/jobs/foo-123"), null);
    assert.equal(shareSurfaceFromUrl("not a url"), null);
});
