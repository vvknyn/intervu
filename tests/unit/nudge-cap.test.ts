import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canShowAutoNudge, markAutoNudgeShown, recordNudgeDismissed } from "../../src/lib/auth/nudge-cap";

// Same mocking pattern as guest-engage-nudge.test.ts, extended to cover
// BOTH storages: the session cap lives in sessionStorage (per-tab, per
// session) and the 7-day dismiss suppression lives in localStorage
// (survives new tabs/sessions).
function installStorage(session: Record<string, string> | null, local: Record<string, string> | null) {
    function backingFor(store: Record<string, string> | null) {
        return store
            ? {
                  getItem: (k: string) => (k in store ? store[k] : null),
                  setItem: (k: string, v: string) => {
                      store[k] = v;
                  },
                  removeItem: (k: string) => {
                      delete store[k];
                  },
              }
            : null;
    }
    const sessionBacking = backingFor(session);
    const localBacking = backingFor(local);
    Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        get() {
            if (!sessionBacking) throw new Error("SecurityError: sessionStorage is not available");
            return sessionBacking;
        },
    });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
            if (!localBacking) throw new Error("SecurityError: localStorage is not available");
            return localBacking;
        },
    });
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { sessionStorage: sessionBacking, localStorage: localBacking },
        writable: true,
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("canShowAutoNudge", () => {
    it("is side-effect-free: repeated calls keep returning true until something marks it shown", () => {
        installStorage({}, {});
        assert.equal(canShowAutoNudge("apply"), true, "first check");
        assert.equal(canShowAutoNudge("apply"), true, "second check, nothing marked it shown");
        assert.equal(canShowAutoNudge("apply"), true, "third check, still nothing marked it shown");
    });

    it("markAutoNudgeShown flips it to false for the rest of the session", () => {
        installStorage({}, {});
        assert.equal(canShowAutoNudge("apply"), true);
        markAutoNudgeShown("apply");
        assert.equal(canShowAutoNudge("apply"), false, "marked shown this session");
        assert.equal(canShowAutoNudge("apply"), false, "still false on a later check");
    });

    it("two reasons are capped independently", () => {
        installStorage({}, {});
        assert.equal(canShowAutoNudge("apply"), true);
        markAutoNudgeShown("apply");
        assert.equal(canShowAutoNudge("save"), true, "a different reason is not blocked by apply's cap");
        markAutoNudgeShown("save");
        assert.equal(canShowAutoNudge("apply"), false);
        assert.equal(canShowAutoNudge("save"), false);
    });

    it("suppresses for 7 days after a dismiss, using an injected clock", () => {
        installStorage({}, {});
        const t0 = Date.parse("2026-01-01T00:00:00Z");
        recordNudgeDismissed("apply", t0);

        assert.equal(canShowAutoNudge("apply", t0 + 1000), false, "right after dismiss");
        assert.equal(canShowAutoNudge("apply", t0 + 6 * DAY_MS), false, "6 days later, still suppressed");
        assert.equal(canShowAutoNudge("apply", t0 + 7 * DAY_MS + 1), true, "just past 7 days, allowed again");
    });

    it("a dismiss for one reason does not suppress a different reason", () => {
        installStorage({}, {});
        const t0 = Date.parse("2026-01-01T00:00:00Z");
        recordNudgeDismissed("apply", t0);
        assert.equal(canShowAutoNudge("save", t0 + 1000), true);
    });

    it("a dismiss recorded for the decided reason does not suppress a different reason on the same open state (PublicJobDetail apply/tailor swap)", () => {
        // PublicJobDetail.tsx opens the same AuthPopover with reason "apply"
        // and reason "tailor" on one shared `open` boolean; a
        // prop swap mid-open must not let a dismiss recorded for the reason
        // the popover was actually shown FOR bleed into the other reason.
        installStorage({}, {});
        recordNudgeDismissed("apply");
        assert.equal(canShowAutoNudge("tailor"), true, "tailor is untouched by an apply dismiss");
        assert.equal(canShowAutoNudge("apply"), false, "apply itself stays suppressed");
    });

    it("returns false, never throws, when storage is unavailable (private mode)", () => {
        installStorage(null, null);
        assert.doesNotThrow(() => {
            assert.equal(canShowAutoNudge("apply"), false);
        });
    });

    it("returns false when sessionStorage works but localStorage throws", () => {
        installStorage({}, null);
        assert.equal(canShowAutoNudge("apply"), false);
    });
});

describe("markAutoNudgeShown", () => {
    it("never throws when sessionStorage is unavailable", () => {
        installStorage(null, {});
        assert.doesNotThrow(() => markAutoNudgeShown("apply"));
    });
});

describe("recordNudgeDismissed", () => {
    it("never throws when localStorage is unavailable", () => {
        installStorage({}, null);
        assert.doesNotThrow(() => recordNudgeDismissed("apply"));
    });
});
