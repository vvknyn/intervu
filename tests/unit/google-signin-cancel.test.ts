import { test } from "node:test";
import assert from "node:assert/strict";
import { isPopupCancelled } from "../../src/lib/firebase/client-auth";

/* --------------------------- isPopupCancelled --------------------------- */

test("isPopupCancelled is true when the user closes the Google popup", () => {
    assert.equal(isPopupCancelled({ code: "auth/popup-closed-by-user" }), true);
});

test("isPopupCancelled is true for a superseded popup request", () => {
    assert.equal(isPopupCancelled({ code: "auth/cancelled-popup-request" }), true);
});

test("isPopupCancelled is false for a blocked popup (that's a different, non-cancel case)", () => {
    assert.equal(isPopupCancelled({ code: "auth/popup-blocked" }), false);
});

test("isPopupCancelled is false for an unrelated auth error", () => {
    assert.equal(isPopupCancelled({ code: "auth/network-request-failed" }), false);
});

test("isPopupCancelled handles null/undefined/non-object input without throwing", () => {
    assert.equal(isPopupCancelled(null), false);
    assert.equal(isPopupCancelled(undefined), false);
    assert.equal(isPopupCancelled("nope"), false);
});
