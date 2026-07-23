import { test } from "node:test";
import assert from "node:assert/strict";
import {
    rememberSearch,
    loadRecentSearches,
    saveRecentSearches,
    clearRecentSearches,
    RECENT_SEARCHES_KEY,
} from "../../src/lib/jobs/recent-searches";

/* ----------------------------- rememberSearch ----------------------------- */

test("rememberSearch prepends a new query", () => {
    assert.deepEqual(rememberSearch([], "backend engineer"), ["backend engineer"]);
});

test("rememberSearch trims whitespace before storing", () => {
    assert.deepEqual(rememberSearch([], "  backend engineer  "), ["backend engineer"]);
});

test("rememberSearch drops an empty/whitespace-only query, list unchanged", () => {
    assert.deepEqual(rememberSearch(["existing"], "   "), ["existing"]);
});

test("rememberSearch drops a single-character query, list unchanged", () => {
    assert.deepEqual(rememberSearch(["existing"], "a"), ["existing"]);
});

test("rememberSearch accepts a 2-character query", () => {
    assert.deepEqual(rememberSearch([], "pm"), ["pm"]);
});

test("rememberSearch dedupes case-insensitively, moving the match to the front under its new casing", () => {
    const list = ["Backend Engineer", "SRE", "PM"];
    assert.deepEqual(rememberSearch(list, "backend engineer"), ["backend engineer", "SRE", "PM"]);
});

test("rememberSearch caps at max (default 3), dropping the oldest", () => {
    assert.deepEqual(rememberSearch(["a1", "b2", "c3"], "d4"), ["d4", "a1", "b2"]);
});

test("rememberSearch respects a custom max", () => {
    assert.deepEqual(rememberSearch(["a1"], "b2", 1), ["b2"]);
});

test("rememberSearch does not mutate the input list", () => {
    const list = ["a1", "b2"];
    rememberSearch(list, "c3");
    assert.deepEqual(list, ["a1", "b2"]);
});

/* -------------------------- localStorage wrappers -------------------------- */

test("loadRecentSearches returns [] when localStorage is unavailable", () => {
    assert.deepEqual(loadRecentSearches(), []);
});

test("saveRecentSearches / clearRecentSearches are no-ops, not throws, without localStorage", () => {
    assert.doesNotThrow(() => saveRecentSearches(["x"]));
    assert.doesNotThrow(() => clearRecentSearches());
});

/** Minimal in-memory Storage stub — Node's test runner has no DOM/localStorage. */
class FakeStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
}

function withFakeStorage(run: () => void): void {
    const target = globalThis as unknown as { localStorage?: Storage };
    target.localStorage = new FakeStorage() as unknown as Storage;
    try {
        run();
    } finally {
        delete target.localStorage;
    }
}

test("save/load round-trips through localStorage", () => {
    withFakeStorage(() => {
        saveRecentSearches(["backend engineer", "pm"]);
        assert.deepEqual(loadRecentSearches(), ["backend engineer", "pm"]);
        clearRecentSearches();
        assert.deepEqual(loadRecentSearches(), []);
    });
});

test("loadRecentSearches degrades to [] on malformed JSON rather than throwing", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, "{not json");
        assert.deepEqual(loadRecentSearches(), []);
    });
});

test("loadRecentSearches degrades to [] on a non-array value rather than throwing", () => {
    withFakeStorage(() => {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify({ not: "an array" }));
        assert.deepEqual(loadRecentSearches(), []);
    });
});
