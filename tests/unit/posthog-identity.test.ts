import { test } from "node:test";
import assert from "node:assert/strict";
import { identityAction } from "../../src/lib/posthog-identity";

test("signing in identifies the account", () => {
  assert.equal(identityAction(null, "uid-1"), "identify");
});

test("the first anonymous callback does NOT reset", () => {
  // onAuthChange fires with null on every page load for a signed-out
  // visitor; calling reset() there would churn the distinct_id mid-visit.
  assert.equal(identityAction(null, null), "none");
});

test("signing out resets, so the next visitor is not merged into the last one", () => {
  assert.equal(identityAction("uid-1", null), "reset");
});

test("a repeated callback for the same user is a no-op", () => {
  // Firebase re-emits the same user on token refresh; re-identifying every
  // hour would add a pointless $identify event per session.
  assert.equal(identityAction("uid-1", "uid-1"), "none");
});

test("switching accounts identifies the new one directly", () => {
  assert.equal(identityAction("uid-1", "uid-2"), "identify");
});
