import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordNudgeDismissed, shouldShowAutoNudge } from "../../src/lib/auth/nudge-cap";

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

describe("shouldShowAutoNudge", () => {
    it("shows once per session per reason, then suppresses further shows this session", () => {
        installStorage({}, {});
        assert.equal(shouldShowAutoNudge("apply"), true, "first show");
        assert.equal(shouldShowAutoNudge("apply"), false, "second show, same session");
        assert.equal(shouldShowAutoNudge("apply"), false, "third show, same session");
    });

    it("two reasons are capped independently", () => {
        installStorage({}, {});
        assert.equal(shouldShowAutoNudge("apply"), true);
        assert.equal(shouldShowAutoNudge("save"), true, "a different reason is not blocked by apply's cap");
        assert.equal(shouldShowAutoNudge("apply"), false);
        assert.equal(shouldShowAutoNudge("save"), false);
    });

    it("suppresses for 7 days after a dismiss, using an injected clock", () => {
        installStorage({}, {});
        const t0 = Date.parse("2026-01-01T00:00:00Z");
        recordNudgeDismissed("apply", t0);

        assert.equal(shouldShowAutoNudge("apply", t0 + 1000), false, "right after dismiss");
        assert.equal(shouldShowAutoNudge("apply", t0 + 6 * DAY_MS), false, "6 days later, still suppressed");
        assert.equal(shouldShowAutoNudge("apply", t0 + 7 * DAY_MS + 1), true, "just past 7 days, allowed again");
    });

    it("a dismiss for one reason does not suppress a different reason", () => {
        installStorage({}, {});
        const t0 = Date.parse("2026-01-01T00:00:00Z");
        recordNudgeDismissed("apply", t0);
        assert.equal(shouldShowAutoNudge("save", t0 + 1000), true);
    });

    it("returns false, never throws, when storage is unavailable (private mode)", () => {
        installStorage(null, null);
        assert.doesNotThrow(() => {
            assert.equal(shouldShowAutoNudge("apply"), false);
        });
    });

    it("returns false when sessionStorage works but localStorage throws", () => {
        installStorage({}, null);
        assert.equal(shouldShowAutoNudge("apply"), false);
    });
});

describe("recordNudgeDismissed", () => {
    it("never throws when localStorage is unavailable", () => {
        installStorage({}, null);
        assert.doesNotThrow(() => recordNudgeDismissed("apply"));
    });
});
