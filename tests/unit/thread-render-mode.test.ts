import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveThreadRenderMode } from "../../src/components/marketing/thread-render-mode";

test("resolveThreadRenderMode plays the reveal when reduced motion is off", () => {
    assert.equal(resolveThreadRenderMode(false), "animated");
});

test("resolveThreadRenderMode renders instantly when reduced motion is on", () => {
    assert.equal(resolveThreadRenderMode(true), "instant");
});

test("resolveThreadRenderMode defaults to animated before the media-query listener attaches (null)", () => {
    assert.equal(resolveThreadRenderMode(null), "animated");
});
