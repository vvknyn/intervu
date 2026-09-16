import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    dismissGuestEngageNudge,
    getGuestJobViewCount,
    getGuestResultClickCount,
    isGuestEngageNudgeDismissed,
    recordGuestJobView,
    recordGuestResultClick,
    shouldShowGuestEngageNudge,
} from "../../src/lib/auth/guest-engage-nudge";

describe("shouldShowGuestEngageNudge — pure decision", () => {
    const base = {
        signedIn: false,
        dismissed: false,
        showingSaveBanner: false,
        resultClicks: 0,
        jobViews: 0,
    };

    it("never shows when signed in", () => {
        assert.equal(
            shouldShowGuestEngageNudge({ ...base, signedIn: true, resultClicks: 5 }),
            false,
        );
    });

    it("never shows when dismissed", () => {
        assert.equal(
            shouldShowGuestEngageNudge({ ...base, dismissed: true, resultClicks: 1 }),
            false,
        );
    });

    it("never shows when the guest-save banner is showing", () => {
        assert.equal(
            shouldShowGuestEngageNudge({ ...base, showingSaveBanner: true, resultClicks: 1 }),
            false,
        );
    });

    it("shows after one result click", () => {
        assert.equal(shouldShowGuestEngageNudge({ ...base, resultClicks: 1 }), true);
    });

    it("does not show with zero engagement", () => {
        assert.equal(shouldShowGuestEngageNudge(base), false);
    });

    it("shows after two job views without a result click", () => {
        assert.equal(shouldShowGuestEngageNudge({ ...base, jobViews: 2 }), true);
    });

    it("does not show after only one job view", () => {
        assert.equal(shouldShowGuestEngageNudge({ ...base, jobViews: 1 }), false);
    });
});

describe("guest engage counters and dismiss — localStorage helpers", () => {
    function installStorage(store: Record<string, string> | null) {
        const backing = store
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
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            get() {
                if (!backing) throw new Error("SecurityError: localStorage is not available");
                return backing;
            },
        });
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: { localStorage: backing },
            writable: true,
        });
    }

    it("increments result clicks and job views independently", () => {
        installStorage({});
        assert.equal(getGuestResultClickCount(), 0);
        assert.equal(recordGuestResultClick(), 1);
        assert.equal(getGuestResultClickCount(), 1);
        assert.equal(getGuestJobViewCount(), 0);
        assert.equal(recordGuestJobView(), 1);
        assert.equal(recordGuestJobView(), 2);
        assert.equal(getGuestJobViewCount(), 2);
    });

    it("persists dismiss", () => {
        installStorage({});
        assert.equal(isGuestEngageNudgeDismissed(), false);
        dismissGuestEngageNudge();
        assert.equal(isGuestEngageNudgeDismissed(), true);
    });
});
