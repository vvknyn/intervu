import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    LAST_JOBS_HOME_VIEW_KEY,
    readLastJobsHomeView,
    writeLastJobsHomeView,
} from "../../src/lib/jobs/for-you/last-home-view";

class FakeLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
}

const fakeLocalStorage = new FakeLocalStorage();
(globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeLocalStorage;

beforeEach(() => {
    fakeLocalStorage.clear();
});

describe("last jobs home view", () => {
    it("round-trips for-you and search", () => {
        writeLastJobsHomeView("for-you");
        assert.equal(readLastJobsHomeView(), "for-you");
        assert.equal(fakeLocalStorage.getItem(LAST_JOBS_HOME_VIEW_KEY), "for-you");
        writeLastJobsHomeView("search");
        assert.equal(readLastJobsHomeView(), "search");
    });

    it("ignores unknown stored values", () => {
        fakeLocalStorage.setItem(LAST_JOBS_HOME_VIEW_KEY, "pending");
        assert.equal(readLastJobsHomeView(), null);
    });
});
