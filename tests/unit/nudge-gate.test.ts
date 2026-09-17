import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideNudgeOnce, nudgeGateNext, shouldRecordDismiss } from "../../src/lib/auth/nudge-gate";

// Run every scenario for two different gated-action reasons so the state
// machine is proven class-wide (any auto nudge), not just the apply gate
// that surfaced the bug.
const REASONS = ["apply", "save"] as const;

for (const reason of REASONS) {
    describe(`nudgeGateNext (${reason})`, () => {
        it("auto + allowed opens to shown", () => {
            const next = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: true });
            assert.equal(next, "shown");
        });

        it("auto + not allowed opens to suppressed", () => {
            const next = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: false });
            assert.equal(next, "suppressed");
        });

        it("user trigger ignores allowed and always opens to shown", () => {
            assert.equal(nudgeGateNext("idle", { type: "open", trigger: "user", allowed: true }), "shown");
            assert.equal(nudgeGateNext("idle", { type: "open", trigger: "user", allowed: false }), "shown");
        });

        it("a second open event while shown does not re-decide (the re-render case)", () => {
            const shown = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: true });
            const reRendered = nudgeGateNext(shown, { type: "open", trigger: "auto", allowed: false });
            assert.equal(reRendered, "shown", "already-shown state survives a re-render with a would-be-different decision");
        });

        it("a second open event while suppressed does not re-decide (the re-render case)", () => {
            const suppressed = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: false });
            const reRendered = nudgeGateNext(suppressed, { type: "open", trigger: "auto", allowed: true });
            assert.equal(reRendered, "suppressed", "already-suppressed state survives a re-render with a would-be-different decision");
        });

        it("close from shown goes to idle and is a recordable dismiss", () => {
            const shown = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: true });
            const closed = nudgeGateNext(shown, { type: "close" });
            assert.equal(closed, "idle");
            assert.equal(shouldRecordDismiss(shown, closed), true);
        });

        it("close from suppressed goes to idle and is NOT a recordable dismiss", () => {
            const suppressed = nudgeGateNext("idle", { type: "open", trigger: "auto", allowed: false });
            const closed = nudgeGateNext(suppressed, { type: "close" });
            assert.equal(closed, "idle");
            assert.equal(shouldRecordDismiss(suppressed, closed), false);
        });
    });
}

describe("shouldRecordDismiss", () => {
    it("is false for any transition that doesn't leave a shown state", () => {
        assert.equal(shouldRecordDismiss("idle", "idle"), false);
        assert.equal(shouldRecordDismiss("suppressed", "idle"), false);
        assert.equal(shouldRecordDismiss("shown", "shown"), false);
    });
});

describe("decideNudgeOnce", () => {
    it("with no prior record, returns the proposed decision", () => {
        const decision = decideNudgeOnce(null, { reason: "apply", trigger: "auto" });
        assert.deepEqual(decision, { reason: "apply", trigger: "auto" });
    });

    it("second decide call with a non-null record returns the existing record unchanged — the StrictMode double-invoke case", () => {
        // AuthPopover's effect has no cleanup, so React StrictMode's
        // synchronous double-invoke runs the setup twice against the same
        // pre-commit closure. Both invocations would compute the same
        // proposed decision from props in practice, but this proves the
        // guard itself: whatever the second call proposes, the record from
        // the first call wins.
        const first = decideNudgeOnce(null, { reason: "apply", trigger: "auto" });
        const second = decideNudgeOnce(first, { reason: "report", trigger: "auto" });
        assert.deepEqual(second, { reason: "apply", trigger: "auto" }, "existing record is unchanged, not overwritten by the second call's proposal");
        assert.equal(second, first, "same object identity — not even a new record shape");
    });
});
