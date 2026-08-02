import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DAILY_APPLY_CAP,
    applyCapMessage,
    utcDayKey,
    hasCapRoom,
    isNewAppliedTransition,
} from "../../src/lib/pursuits/apply-cap";
import type { PursuitStage } from "../../src/lib/pursuits/types";

/* --------------------------------- hasCapRoom --------------------------------- */
// The pure "under cap" / "at cap" decision — separated from the Firestore
// transaction in apply-cap.ts precisely so it's testable without mocking
// Firestore.

test("hasCapRoom allows counts under the cap", () => {
    assert.equal(hasCapRoom(0), true);
    assert.equal(hasCapRoom(5), true);
    assert.equal(hasCapRoom(DAILY_APPLY_CAP - 1), true);
});

test("hasCapRoom denies at the cap and beyond", () => {
    assert.equal(hasCapRoom(DAILY_APPLY_CAP), false);
    assert.equal(hasCapRoom(DAILY_APPLY_CAP + 1), false);
});

test("hasCapRoom respects an injected cap, not just the default constant", () => {
    // Proves the function is parameterized rather than closing over the
    // exported constant internally.
    assert.equal(hasCapRoom(3, 5), true);
    assert.equal(hasCapRoom(5, 5), false);
});

/* --------------------------------- isNewAppliedTransition --------------------------------- */
// Idempotency: re-marking the SAME job applied (or a pursuit already further
// along) must never consume a second cap slot.

test("a brand-new pursuit going straight to applied counts", () => {
    assert.equal(isNewAppliedTransition("applied", undefined), true);
});

test("interested -> applied is a new applied transition", () => {
    assert.equal(isNewAppliedTransition("applied", "interested"), true);
});

test("re-marking an already-applied pursuit applied again is idempotent (no double-count)", () => {
    assert.equal(isNewAppliedTransition("applied", "applied"), false);
});

test("a pursuit already further along (interviewing/offer) does not count again", () => {
    const further: PursuitStage[] = ["interviewing", "offer", "rejected", "withdrawn"];
    for (const status of further) {
        assert.equal(isNewAppliedTransition("applied", status), false, `stage ${status} should not re-count`);
    }
});

test("transitions to any stage other than applied never consume a cap slot", () => {
    const stages: PursuitStage[] = ["interested", "resume_ready", "interviewing", "offer", "rejected", "withdrawn"];
    for (const stage of stages) {
        assert.equal(isNewAppliedTransition(stage, undefined), false, `stage ${stage} should never count`);
    }
});

/* --------------------------------- utcDayKey --------------------------------- */
// The cap resets at UTC midnight — proven by the day key itself changing
// across that boundary, with an injectable clock (no real waiting).

test("utcDayKey is stable within the same UTC day", () => {
    const morning = Date.parse("2026-08-02T00:05:00.000Z");
    const night = Date.parse("2026-08-02T23:55:00.000Z");
    assert.equal(utcDayKey(morning), utcDayKey(night));
    assert.equal(utcDayKey(morning), "2026-08-02");
});

test("utcDayKey resets across the UTC midnight boundary", () => {
    const beforeMidnight = Date.parse("2026-08-02T23:59:59.999Z");
    const afterMidnight = Date.parse("2026-08-03T00:00:00.000Z");
    assert.notEqual(utcDayKey(beforeMidnight), utcDayKey(afterMidnight));
    assert.equal(utcDayKey(afterMidnight), "2026-08-03");
});

/* --------------------------------- applyCapMessage --------------------------------- */

test("applyCapMessage is derived from the cap number, not a re-typed literal", () => {
    assert.equal(applyCapMessage(20), applyCapMessage(DAILY_APPLY_CAP));
    assert.ok(applyCapMessage(7).includes("7"));
    assert.ok(applyCapMessage().includes(String(DAILY_APPLY_CAP)));
});
